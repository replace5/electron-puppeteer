import EventEmitter from "./EventEmitter.js"
const {remote} = require("electron")

export default class NetworkManager extends EventEmitter {
  constructor() {
    super()

    this._userCacheDisabled = false
    this._userRequestInterceptionEnabled = false
    this._protocolRequestInterceptionEnabled = false

    /** @type {!Map<string, !Request>} */
    this._requestIdToRequest = new Map()
    /** @type {!Map<string, !Protocol.Network.requestWillBeSentPayload>} */
    this._requestIdToRequestWillBeSentEvent = new Map()
    /** @type {!Map<string, string>} */
    this._requestIdToInterceptionId = new Map()
  }
  start(webContentsId) {
    let contents = remote.webContents.fromId(webContentsId)
    if (!contents) {
      return
    }
    this._webContents = contents
    this._client = this._webContents.debugger
    if (!this._client.isAttached()) {
      this._client.attach("1.1")
    }

    this._client.on("message", (_, method, params) => {
      try {
        switch (method) {
          case "Fetch.requestPaused":
            this._onRequestPaused(params)
            break
          case "Network.requestWillBeSent":
            this._onRequestWillBeSent(params)
            break
          case "Network.responseReceived":
            this._onResponseReceived(params)
            break
          case "Network.requestServedFromCache":
            this._onRequestServedFromCache(params)
            break
          case "Network.loadingFinished":
            this._onLoadingFinished(params)
            break
          case "Network.loadingFailed":
            this._onLoadingFailed(params)
            break
        }
      } catch (e) {
        console.error("NetworkManager error:", e)
      }
    })

    this._client.sendCommand("Network.enable")
  }
  _onRequestWillBeSent(params) {
    // Request interception doesn't happen for data URLs with Network Service.
    if (
      this._protocolRequestInterceptionEnabled &&
      !params.request.url.startsWith("data:")
    ) {
      const requestId = params.requestId
      const interceptionId = this._requestIdToInterceptionId.get(requestId)
      if (interceptionId) {
        this._onRequest(params, interceptionId)
        this._requestIdToInterceptionId.delete(requestId)
      } else {
        this._requestIdToRequestWillBeSentEvent.set(params.requestId, params)
      }
      return
    }
    this._onRequest(params, null)
  }
  /**
   * @param {!Protocol.Fetch.requestPausedPayload} params
   */
  _onRequestPaused(params) {
    if (
      !this._userRequestInterceptionEnabled &&
      this._protocolRequestInterceptionEnabled
    ) {
      this._client
        .send("Fetch.continueRequest", {
          requestId: params.requestId,
        })
        .catch((err) => {
          console.error("NetworkManager.continueRequest error:", err)
        })
    }

    const requestId = params.networkId
    const interceptionId = params.requestId
    if (requestId && this._requestIdToRequestWillBeSentEvent.has(requestId)) {
      const requestWillBeSentEvent = this._requestIdToRequestWillBeSentEvent.get(
        requestId
      )
      this._onRequest(requestWillBeSentEvent, interceptionId)
      this._requestIdToRequestWillBeSentEvent.delete(requestId)
    } else {
      this._requestIdToInterceptionId.set(requestId, interceptionId)
    }
  }
  /**
   * @param {!Protocol.Network.requestWillBeSentPayload} params
   * @param {?string} interceptionId
   */
  _onRequest(params, interceptionId) {
    let redirectChain = []
    if (params.redirectResponse) {
      const request = this._requestIdToRequest.get(params.requestId)
      if (request) {
        this._handleRequestRedirect(request, params.redirectResponse)
        redirectChain = request._redirectChain
      }
    }

    const request = new Request(
      this._client,
      interceptionId,
      this._userRequestInterceptionEnabled,
      params,
      redirectChain
    )
    this._requestIdToRequest.set(params.requestId, request)
    this.emit("request", request)
  }
  /**
   * @param {!Protocol.Network.requestServedFromCachePayload} event
   */
  _onRequestServedFromCache(event) {
    const request = this._requestIdToRequest.get(event.requestId)
    if (request) {
      request._fromMemoryCache = true
    }
  }
  _handleRequestRedirect(request, responsePayload) {
    const response = new Response(this._client, request, responsePayload)
    request._response = response
    request._redirectChain.push(request)
    response._bodyLoadedPromiseFulfill.call(
      null,
      new Error("Response body is unavailable for redirect responses")
    )
    this._requestIdToRequest.delete(request._requestId)
    this.emit("response", response)
    this.emit("requestfinished", request)
  }
  _onResponseReceived(params) {
    const request = this._requestIdToRequest.get(params.requestId)
    if (!request) {
      return
    }

    const response = new Response(this._client, request, params.response)
    request._response = response

    this.emit("response", response)
  }
  _onLoadingFinished(params) {
    const request = this._requestIdToRequest.get(params.requestId)
    if (!request) {
      return
    }
    if (request.response()) {
      request.response()._bodyLoadedPromiseFulfill.call(null)
    }
    this._requestIdToRequest.delete(request._requestId)
    this.emit("requestfinished", request)
  }
  _onLoadingFailed(params) {
    const request = this._requestIdToRequest.get(params.requestId)
    if (!request) {
      return
    }
    request._failureText = params.errorText
    const response = request.response()
    if (response) {
      response._bodyLoadedPromiseFulfill.call(null)
    }

    this._requestIdToRequest.delete(request._requestId)
    this.emit("requestfailed", request)
  }
  /**
   * @param {boolean} enabled
   */
  async setCacheEnabled(enabled) {
    this._userCacheDisabled = !enabled
    await this._updateProtocolCacheDisabled()
  }
  /**
   * @param {boolean} value
   */
  async setRequestInterception(value) {
    this._userRequestInterceptionEnabled = value
    await this._updateProtocolRequestInterception()
  }
  async _updateProtocolRequestInterception() {
    const enabled = this._userRequestInterceptionEnabled
    if (enabled === this._protocolRequestInterceptionEnabled) {
      return
    }
    this._protocolRequestInterceptionEnabled = enabled
    if (enabled) {
      await Promise.all([
        this._updateProtocolCacheDisabled(),
        this._client.send("Fetch.enable", {
          handleAuthRequests: true,
          patterns: [{urlPattern: "*"}],
        }),
      ])
    } else {
      await Promise.all([
        this._updateProtocolCacheDisabled(),
        this._client.send("Fetch.disable"),
      ])
    }
  }
  async _updateProtocolCacheDisabled() {
    await this._client.send("Network.setCacheDisabled", {
      cacheDisabled:
        this._userCacheDisabled || this._protocolRequestInterceptionEnabled,
    })
  }
}

export class Request {
  constructor(
    client,
    interceptionId,
    allowInterception,
    params,
    redirectChain
  ) {
    this._client = client
    this._requestId = params.requestId
    this._isNavigationRequest =
      params.requestId === params.loaderId && params.type === "Document"
    this._interceptionId = interceptionId
    this._allowInterception = allowInterception
    this._interceptionHandled = false
    this._response = null
    this._failureText = null

    this._url = params.request.url
    this._resourceType = params.type.toLowerCase()
    this._method = params.request.method
    this._postData = params.request.postData
    this._headers = {}
    this._redirectChain = redirectChain
    for (const key of Object.keys(params.request.headers)) {
      this._headers[key.toLowerCase()] = params.request.headers[key]
    }

    this._fromMemoryCache = false
  }
  /**
   * @return {string}
   */
  url() {
    return this._url
  }

  /**
   * @return {string}
   */
  resourceType() {
    return this._resourceType
  }

  /**
   * @return {string}
   */
  method() {
    return this._method
  }

  /**
   * @return {string|undefined}
   */
  postData() {
    return this._postData
  }

  /**
   * @return {!Object}
   */
  headers() {
    return this._headers
  }

  /**
   * @return {?Response}
   */
  response() {
    return this._response
  }

  /**
   * @return {boolean}
   */
  isNavigationRequest() {
    return this._isNavigationRequest
  }

  /**
   * @return {!Array<!Request>}
   */
  redirectChain() {
    return this._redirectChain.slice()
  }

  /**
   * @return {?{errorText: string}}
   */
  failure() {
    if (!this._failureText) {
      return null
    }

    return {
      errorText: this._failureText,
    }
  }

  /**
   * @param {!Object} overrides
   * @param {?string} overrides.url
   * @param {?string} overrides.method
   * @param {?string} overrides.postData
   * @param {?Object} overrides.headers
   */
  async continue(overrides = {}) {
    // Request interception is not supported for data: urls.
    if (this._url.startsWith("data:")) {
      return
    }
    if (!this._allowInterception) {
      throw new Error("Request Interception is not enabled!")
    }
    if (!!this._interceptionHandled) {
      throw new Error("Request is already handled!")
    }
    const {url, method, postData, headers} = overrides
    this._interceptionHandled = true
    await this._client
      .send("Fetch.continueRequest", {
        requestId: this._interceptionId,
        url,
        method,
        postData,
        headers: headers ? headersArray(headers) : undefined,
      })
      .catch((error) => {
        console.error("Request.continue error: ", error)
      })
  }

  /**
   * @param {!{status: number, headers: Object, contentType: string, body: (string|Buffer)}} response
   */
  async respond(response) {
    // Mocking responses for dataURL requests is not currently supported.
    if (this._url.startsWith("data:")) {
      return
    }
    if (!this._allowInterception) {
      throw new Error("Request Interception is not enabled!")
    }
    if (!!this._interceptionHandled) {
      throw new Error("Request is already handled!")
    }
    this._interceptionHandled = true

    const responseBody =
      response.body && typeof response.body === "string"
        ? Buffer.from(/** @type {string} */ (response.body))
        : /** @type {?Buffer} */ (response.body || null)

    /** @type {!Object<string, string>} */
    const responseHeaders = {}
    if (response.headers) {
      for (const header of Object.keys(response.headers)) {
        responseHeaders[header.toLowerCase()] = response.headers[header]
      }
    }
    if (response.contentType) {
      responseHeaders["content-type"] = response.contentType
    }
    if (responseBody && !("content-length" in responseHeaders)) {
      responseHeaders["content-length"] = String(
        Buffer.byteLength(responseBody)
      )
    }

    await this._client
      .send("Fetch.fulfillRequest", {
        requestId: this._interceptionId,
        responseCode: response.status || 200,
        responsePhrase: STATUS_TEXTS[response.status || 200],
        responseHeaders: headersArray(responseHeaders),
        body: responseBody ? responseBody.toString("base64") : undefined,
      })
      .catch((error) => {
        console.error("Request.respond error:", error)
      })
  }

  /**
   * @param {string=} errorCode
   */
  async abort(errorCode = "failed") {
    // Request interception is not supported for data: urls.
    if (this._url.startsWith("data:")) {
      return
    }
    const errorReason = errorReasons[errorCode]
    if (!errorReason) {
      throw new Error("Unknown error code: " + errorCode)
    }
    if (!this._allowInterception) {
      throw new Error("Request Interception is not enabled!")
    }
    if (!!this._interceptionHandled) {
      throw new Error("Request is already handled!")
    }
    this._interceptionHandled = true
    await this._client
      .send("Fetch.failRequest", {
        requestId: this._interceptionId,
        errorReason,
      })
      .catch((error) => {
        console.error("Request.abort error: ", error)
      })
  }
}

export class Response {
  constructor(client, request, responsePayload) {
    this._client = client
    this._request = request
    this._contentPromise = null

    this._bodyLoadedPromise = new Promise((fulfill) => {
      this._bodyLoadedPromiseFulfill = fulfill
    })

    this._remoteAddress = {
      ip: responsePayload.remoteIPAddress,
      port: responsePayload.remotePort,
    }
    this._status = responsePayload.status
    this._statusText = responsePayload.statusText
    this._url = request.url()
    this._fromDiskCache = !!responsePayload.fromDiskCache
    this._fromServiceWorker = !!responsePayload.fromServiceWorker
    this._headers = {}
    for (const key of Object.keys(responsePayload.headers)) {
      this._headers[key.toLowerCase()] = responsePayload.headers[key]
    }
  }

  /**
   * @return {{ip: string, port: number}}
   */
  remoteAddress() {
    return this._remoteAddress
  }

  /**
   * @return {string}
   */
  url() {
    return this._url
  }

  /**
   * @return {boolean}
   */
  ok() {
    return this._status === 0 || (this._status >= 200 && this._status <= 299)
  }

  /**
   * @return {number}
   */
  status() {
    return this._status
  }

  /**
   * @return {string}
   */
  statusText() {
    return this._statusText
  }

  /**
   * @return {!Object}
   */
  headers() {
    return this._headers
  }

  /**
   * @return {!Promise<!Buffer>}
   */
  buffer() {
    if (!this._contentPromise) {
      this._contentPromise = this._bodyLoadedPromise.then(async (error) => {
        if (error) throw error
        const response = await this._client.sendCommand(
          "Network.getResponseBody",
          {
            requestId: this._request._requestId,
          }
        )
        return Buffer.from(
          response.body,
          response.base64Encoded ? "base64" : "utf8"
        )
      })
    }
    return this._contentPromise
  }

  /**
   * @return {!Promise<string>}
   */
  async text() {
    const content = await this.buffer()
    return content.toString("utf8")
  }

  /**
   * @return {!Promise<!Object>}
   */
  async json() {
    const content = await this.text()
    return JSON.parse(content)
  }

  /**
   * @return {!Request}
   */
  request() {
    return this._request
  }

  /**
   * @return {boolean}
   */
  fromCache() {
    return this._fromDiskCache || this._request._fromMemoryCache
  }
  /**
   * @return {boolean}
   */
  fromServiceWorker() {
    return this._fromServiceWorker
  }
}

/**
 * @param {Object<string, string>} headers
 * @return {!Array<{name: string, value: string}>}
 */
function headersArray(headers) {
  const result = []
  for (const name in headers) {
    result.push({name, value: headers[name] + ""})
  }

  return result
}

// List taken from https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml with extra 306 and 418 codes.
const STATUS_TEXTS = {
  "100": "Continue",
  "101": "Switching Protocols",
  "102": "Processing",
  "103": "Early Hints",
  "200": "OK",
  "201": "Created",
  "202": "Accepted",
  "203": "Non-Authoritative Information",
  "204": "No Content",
  "205": "Reset Content",
  "206": "Partial Content",
  "207": "Multi-Status",
  "208": "Already Reported",
  "226": "IM Used",
  "300": "Multiple Choices",
  "301": "Moved Permanently",
  "302": "Found",
  "303": "See Other",
  "304": "Not Modified",
  "305": "Use Proxy",
  "306": "Switch Proxy",
  "307": "Temporary Redirect",
  "308": "Permanent Redirect",
  "400": "Bad Request",
  "401": "Unauthorized",
  "402": "Payment Required",
  "403": "Forbidden",
  "404": "Not Found",
  "405": "Method Not Allowed",
  "406": "Not Acceptable",
  "407": "Proxy Authentication Required",
  "408": "Request Timeout",
  "409": "Conflict",
  "410": "Gone",
  "411": "Length Required",
  "412": "Precondition Failed",
  "413": "Payload Too Large",
  "414": "URI Too Long",
  "415": "Unsupported Media Type",
  "416": "Range Not Satisfiable",
  "417": "Expectation Failed",
  "418": "I'm a teapot",
  "421": "Misdirected Request",
  "422": "Unprocessable Entity",
  "423": "Locked",
  "424": "Failed Dependency",
  "425": "Too Early",
  "426": "Upgrade Required",
  "428": "Precondition Required",
  "429": "Too Many Requests",
  "431": "Request Header Fields Too Large",
  "451": "Unavailable For Legal Reasons",
  "500": "Internal Server Error",
  "501": "Not Implemented",
  "502": "Bad Gateway",
  "503": "Service Unavailable",
  "504": "Gateway Timeout",
  "505": "HTTP Version Not Supported",
  "506": "Variant Also Negotiates",
  "507": "Insufficient Storage",
  "508": "Loop Detected",
  "510": "Not Extended",
  "511": "Network Authentication Required",
}
