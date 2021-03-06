/**
 * @file Page Page类
 */

import EventEmitter from "./EventEmitter.js"
import Frame from "./Frame.js"
import {
  isString,
  isFunction,
  uniqueId,
  proxyBindDecorator,
  importStyle,
  TimeoutPromise,
} from "./util.js"
import {BoundIpc} from "./ipc.js"
import styleCss from "./style.css.js"
import NetwordManager from "./NetworkManager.js"
import ChromeSearch from "./libs/chrome-search"
import ChromeZoom from "./libs/chrome-zoom"
importStyle(styleCss, "electron-puppeteer-page")

const {remote} = require("electron")
const contextMenu = require("electron-context-menu")
const fs = require("fs")

/**
 * @class Page
 * @extends EventEmitter
 *
 * @property {string} id 当前实例的唯一id
 * @property {boolean} closed 当前page是否关闭
 * @property {boolean} isFront 当前page是否激活状态
 * @property {boolean} isReady 首次dom-ready后isReady为true
 * @property {Element} container 容器dom
 * @property {WebviewTag} webview 页面对应的webview
 * @property {Session} session webview对应的Session实例
 * @property {WebRequest} webRequest webview对应的WebRequest实例
 * @property {Ipc} ipc ipc通信实例，可用于和webview的主页面和所有iframe通信
 * @property {Object} options 传入的配置信息
 *
 */
class Page extends EventEmitter {
  /**
   * Page构造函数
   * @constructor Page
   *
   * @param {Browser} browser
   * @param {PageOptions} options 传入配置
   * @param {Element} options.container DOM容器
   * @param {boolean} [options.devtools] 是否打开控制台
   * @param {string} [options.partition] session标识，相同的partition共享登录状态
   * @param {string} [options.userAgent] userAgent
   * @param {boolean} [options.allowPopups] allowPopups
   * @param {number} [options.loadingTimeout] 页面加载超时时间, 默认10s
   * @param {string} [options.startUrl] 初始页面
   * @param {string} [options.startUrlReferrer] startUrl的referrer
   * @param {string} options.preload preload的脚本路径, 理论上必须为当前包的preload/webivew.preload.js
   * @param {string} [options.webpreferences] 网页功能的设置
   *
   */
  constructor(browser, options) {
    super()

    this._browser = browser
    this.id = uniqueId("page_")
    this.startTime = Date.now()
    this.options = options
    this.closed = false
    this.isFront = false
    this.isReady = false
    this.isCrashed = false
    this.isDestroyed = false
    this.container = options.container
    this._url = ""
    this._frames = []
    this._target = null
    this.isBrowserPage = false
    this._readyListeners = []
  }
  /**
   * 初始化函数
   *
   * @return {Promise<undefined>}
   */
  init() {
    this.build()
    this._mainFrame = new Frame(this, this.webview, {
      UUID: "~",
      webContentsId: this.webContentsId,
      routingId: this.routingId,
      isMainFrame: true,
      url: this._url,
    })

    if (!this.isBrowserPage) {
      this.chromeSearch = new ChromeSearch(this)
      this.chromeZoom = new ChromeZoom(this)
    }
  }
  _createWebview() {
    const {
      preload,
      webpreferences,
      partition,
      userAgent,
      allowPopups,
    } = this.options

    const $dom = document.createElement("div")
    $dom.className = "electron-puppeteer-page"
    this.$dom = $dom

    const webview = document.createElement("webview")
    webview.partition = partition
    webview.useragent = userAgent
    webview.allowpopups = allowPopups || false
    // 先打开about:blank，拿到webContents后再跳转
    webview.src = "about:blank"
    webview.nodeintegrationinsubframes = true
    webview.nodeintegration = false
    webview.preload = preload
    // HACK: 通过webpreferences传参给webview的webContents
    webview.webpreferences =
      (webpreferences || "") +
      (webpreferences ? "," : "") +
      "nativeWindowOpen=yes" +
      (allowPopups ? ",electron-puppeteer-allow-popups=1" : "") +
      `,electron-puppeteer-browser-id=${this.browser().id}` +
      `,electron-puppeteer-page-id=${this.id}`
    webview.addEventListener("close", () => {
      this.close()
    })
    $dom.appendChild(webview)
    this.container.appendChild($dom)

    return webview
  }
  /**
   * 构建函数
   *
   * @return {Promise<undefined>}
   */
  build() {
    let webview = (this.webview = this._createWebview())
    this.session = remote.session.fromPartition(this.options.partition)
    this.webRequest = this.session.webRequest

    this.ipc = new BoundIpc(this.webview, "*")
    this._initAjaxInterceptors()
    this._initNetworkManager()
    this._handleReady(webview)
  }
  _handleReady(webview) {
    const _onReady = () => {
      if (this._mainFrame) {
        this._mainFrame.webContentsId = this.webContentsId
      }

      this._listenFramesRegister()
      this._listenFramesUnregister()
      this._bindWebviewEvent()
      this._bindIPCEvent()

      this.networkManager.start(this.getWebContentsId())
      this._bindContextMenu()

      if (this.options.devtools) {
        webview.openDevTools()
      }
    }
    if (this.isReady) {
      _onReady()
    } else {
      const _onBlankReady = () => {
        webview.removeEventListener("dom-ready", _onBlankReady)
        const {
          url,
          referrer,
          startUrl,
          startUrlReferrer,
          userAgent,
        } = this.options
        webview.clearHistory()
        webview.loadURL(url || startUrl, {
          httpReferrer: referrer || startUrlReferrer,
          userAgent,
        })
        setTimeout(() => {
          this.isReady = true
          this.webContentsId = this.getWebContentsId()
          this._readyListeners.forEach((item) => item.resolve(true))
          this._readyListeners = []
          _onReady()
        }, 0)
      }
      webview.addEventListener("dom-ready", _onBlankReady)
    }
  }
  _getDOM() {
    return this.$dom
  }
  _getWebview() {
    return this.webview
  }
  _waitForReady() {
    return new TimeoutPromise((resolve, _, ctx) => {
      if (!this.isReady) {
        let id = uniqueId("readyListener")
        this._readyListeners.push({id, resolve})
        ctx.timeoutCallback = () => {
          this._readyListeners = this._readyListeners.filter(
            (item) => item.id === id
          )
        }
      }
    }, this.options.loadingTimeout || 1e4)
  }
  // 初始化networkManager
  _initNetworkManager() {
    this.networkManager = new NetwordManager()

    this._prxoyEventEmitter(this.networkManager, [
      "response",
      "response",
      "requestfinished",
      "requestfailed",
    ])
  }
  // ajaxInterceptors初始化
  _initAjaxInterceptors() {
    this.ajaxInterceptors = {
      /**
       * @name urlMatch
       * @function
       * @param {Object} parsedUrl 格式化后的url
       * @param {string} url 当前请求的url
       * @return {boolean} 是否匹配上
       */

      /**
       * @name reqUpdater
       * @function
       * @param {Object} parsedUrl 格式化后的url
       * @param {Object} interceptor 劫持对象，即传入的参数
       * @return {string|Object} 修改headers时返回Object，其它返回string
       */

      /**
       * @name resUpdater
       * @function
       * @param {Object} parsedUrl 格式化后的url
       * @param {Object} interceptor 劫持对象，即传入的参数
       * @return {string|Object} 修改headers时返回Object，修改body时返回string
       */

      /**
       * 添加ajax劫持
       * @param {!Object} interceptor 劫持对象
       *
       * 以下为过滤条件属性，为空时不过滤，多个属性同时存在时需同时满足
       * @param {?string} interceptor.method 匹配ajax方法
       * @param {?string} interceptor.protocol 匹配ajax协议
       * @param {?string} interceptor.host 匹配ajax host
       * @param {?string} interceptor.path 匹配ajax请求的路径
       * @param {?string|urlMatch} interceptor.url 匹配ajax的请求url,可以为函数
       *
       * @param {?Object} interceptor.request 请求内容修改
       * @param {?string|reqUpdater} interceptor.request.url 修改请求url
       * @param {?string|reqUpdater} interceptor.request.path 修改请求path
       * @param {?string|reqUpdater} interceptor.request.query 修改请求get参数，不为空时需要以?开头
       * @param {?Object|reqUpdater} interceptor.request.headers 修改请求headers
       * @param {?string|reqUpdater} interceptor.request.body 修改请求body, 支持非string类型的body
       *
       * @param {?Object} interceptor.response 响应内容修改
       * @param {?Object|resUpdater} interceptor.response.headers 修改响应headers
       * @param {?string|resUpdater} interceptor.response.body 修改响应body, 支持非string类型的body
       * @return Promise<string> 返回劫持对象的唯一id
       */
      add: (interceptor) => {
        function _functionPropertiesToString(obj) {
          let ret = {...obj}
          for (let key in ret) {
            if (ret.hasOwnProperty(key) && isFunction(ret[key])) {
              ret[key] = ret[key].toString()
            }
          }
          return ret
        }

        // 将函数转成string传输
        let formatedInterceptor = {
          ...interceptor,
          url: isFunction(interceptor.url)
            ? interceptor.url.toString()
            : interceptor.url,
          request: interceptor.request
            ? _functionPropertiesToString(interceptor.request)
            : null,
          response: interceptor.response
            ? _functionPropertiesToString(interceptor.response)
            : null,
        }

        return this.ipc.send("page.ajaxInterceptors.add", formatedInterceptor)
      },
      /**
       * 移除ajax劫持
       *
       * @param {string} interceptorId 劫持对象id
       * @return Promise<boolean>
       */
      remove: (interceptorId) => {
        return this.ipc.send("page.ajaxInterceptors.remove", interceptorId)
      },
    }
  }
  // 监听页面的iframe的注册事件
  _listenFramesRegister() {
    this.ipc.on("frame.register", (frameInfo) => {
      if (!frameInfo.isMainFrame) {
        let originInfo = this._frames.find(
          (item) => item.UUID === frameInfo.UUID
        )
        if (originInfo) {
          Object.assign(originInfo, frameInfo)
        } else {
          this._frames.push(frameInfo)
        }

        let originRouting = this._frames.find(
          (item) => item.routingId === frameInfo.routingId
        )
        /**
         * 当iframe被首次加载时触发
         * @event Page#frameattached
         * @type {Object}
         * @property {string} name iframe的name
         * @property {string} url iframe的url
         */

        /**
         * 当iframe发生跳转时触发
         * @event Page#framenavigated
         * @internal
         * @type {Object}
         * @property {string} name iframe的name
         * @property {string} url iframe的url
         */
        this.emit(originRouting ? "framenavigated" : "frameattached", frameInfo)
      } else {
        // mainFrame的_webContentsId
        this.routingId = frameInfo.routingId
        if (this._mainFrame) {
          this._mainFrame.webContentsId = frameInfo.webContentsId
          this._mainFrame.routingId = frameInfo.routingId
          this._url = this._mainFrame._url = frameInfo.url
        }

        /**
         * 当和页面建立起连接时触发
         * 页面跳转之前会断开连接，刷新或跳转完成后会再次建立连接
         * 在domcontentloaded事件之前
         * @event Page#connect
         * @internal
         * @type {Object}
         * @property {string} url 页面的url
         */
        this.emit("connect", {
          url: frameInfo.url,
        })
      }
      this.emit("frame.register", frameInfo)

      return {
        pageId: this.id,
        browserId: this.browser().id,
      }
    })
  }
  getWebContentsId() {
    if (this.webContentsId) {
      return this.webContentsId
    }
    return this.webview.getWebContentsId()
  }
  getWebContents() {
    if (this.webContents) {
      return this.webContents
    }
    let webContentsId = this.getWebContentsId()
    return webContentsId ? remote.webContents.fromId(webContentsId) : null
  }
  // 监听页面的iframe的注销事件
  _listenFramesUnregister() {
    this.ipc.on("frame.unregister", (frameInfo) => {
      if (!frameInfo.isMainFrame) {
        this._frames = this._frames.filter(
          (item) => item.UUID !== frameInfo.UUID
        )

        /**
         * 当iframe被删除时触发
         * @event Page#framedetached
         * @type {Object}
         * @property {string} name iframe的name
         * @property {string} url iframe的url
         */
        this.emit("framedetached", frameInfo)
      } else {
        /**
         * 当页面断开连接时触发
         * @event Page#disconnect
         * @type {Object}
         * @property {string} url 当前页面的url
         */
        this.emit("disconnect", {
          url: frameInfo.url,
        })
      }
    })
  }
  // 转发webview的dom事件
  _proxyDOMEvent(originName, emitName, getPayload, isMainFrame) {
    this.webview.addEventListener(originName, (evt) => {
      if (!isMainFrame || evt.isMainFrame) {
        this.emit(emitName, getPayload ? getPayload.call(this, evt) : evt)
      }
    })
    return this
  }
  // 转发ipc事件
  _prxoyIPCEvent(
    originName,
    emitName,
    modifyPayload,
    isMainFrame,
    notMainFrame
  ) {
    this.ipc.on(originName, (payload) => {
      if (
        payload &&
        (!isMainFrame || payload.isMainFrame) &&
        (!notMainFrame || !payload.isMainFrame)
      ) {
        modifyPayload && modifyPayload(payload)
        this.emit(emitName, payload)
      }
    })
    return this
  }
  // 转发EventEmitter消息
  _prxoyEventEmitter(eventEmitter, events) {
    let eventNames = Array.isArray(events)
      ? events.slice(0)
      : Object.keys(events)

    for (let evtName of eventNames) {
      let emitName = Array.isArray(events) ? evtName : events[evtName]
      eventEmitter.on(eventNames, this.emit.bind(this, emitName))
    }

    return this
  }
  // 监听webview的dom事件
  _bindWebviewEvent() {
    /**
     * proxy webview Event:"did-start-loading"
     * @event Page#load-start
     */

    /**
     * proxy webview Event:"did-fail-load"
     * @event Page#load-fail
     */

    /**
     * proxy webview Event:"did-stop-loading", Event:"did-finish-load", Event:"did-frame-finish-load"(isMainFrame=true)
     * @event Page#load-end
     */

    /** 页面标题更新
     * @event Page#title-updated
     * @type {Object}
     * @property {string} title
     */

    /** icon更新
     * @event Page#favicon-updated
     * @type {Object}
     * @property {string} favicon
     */

    /** proxy webview Event:"console-message"
     * @event Page#console
     */

    /** proxy webview Event:"new-window"
     * @event Page#new-window
     */

    /** proxy webview Event:"will-navigate"
     * @event Page#will-navigate
     */

    /**
     * 页面的dom加载完毕
     * @event Page#dom-ready
     * @type {Object}
     * @property {string} url 页面url
     */

    this._proxyDOMEvent("did-start-loading", "load-start")
      ._proxyDOMEvent("did-stop-loading", "load-end")
      // ._proxyDOMEvent("did-fail-load", "load-fail", null, true)
      // ._proxyDOMEvent("did-finish-load", "load-end", null, true)
      // ._proxyDOMEvent("did-frame-finish-load", "load-end", null, true)
      ._proxyDOMEvent("page-title-updated", "title-updated")
      ._proxyDOMEvent("favicon-updated", "favicon-updated", (evt) => {
        evt.favicon = evt.favicons.pop()
        return evt
      })
      ._proxyDOMEvent("console-message", "console")
      ._proxyDOMEvent("new-window", "new-window")
      ._proxyDOMEvent("will-navigate", "will-navigate")
      ._proxyDOMEvent("crashed", "crashed")
      ._proxyDOMEvent("dom-ready", "dom-ready", () => ({url: this.url()}))

    this.webview.addEventListener("crashed", this._onCrashed.bind(this))
    this.webview.addEventListener("destroyed", this._onDestroyed.bind(this))
  }
  // 监听ipc事件
  _bindIPCEvent() {
    /**
     * 页面 onload时触发
     * @event Page#load
     * @type {Object}
     * @property {string} url 页面的url
     */

    /**
     * 页面 domcontentloaded时触发
     * @event Page#domcontentloaded
     * @type {Object}
     * @property {string} url 页面的url
     */

    /**
     * 页面 history.pushState, history.peplaceState时触发
     * @event Page#historyNavigation
     * @type {Object}
     * @property {string} url 页面的url
     */

    /**
     * 页面hash变化时触发
     * @event Page#hashchange
     * @type {Object}
     * @property {string} url 页面的url
     */

    this._prxoyIPCEvent("page.title", "title-updated")
      ._prxoyIPCEvent("page.favicon", "favicon-updated")
      ._prxoyIPCEvent("page.foreground-tab", "foreground-tab")
      ._prxoyIPCEvent("frame.load", "load", null, true)
      ._prxoyIPCEvent("frame.domcontentloaded", "domcontentloaded", null, true)
      ._prxoyIPCEvent("frame.hashchange", "hashchange", null, true)
      ._prxoyIPCEvent(
        "frame.historyNavigation",
        "historyNavigation",
        null,
        true
      )

    this.ipc.on("page.event", (payload) => {
      /**
       * 页面 dom 事件
       * @event Page#dom-event
       * @type {Object}
       * @property {string} type 事件类型
       * @property {Frame} frame 事件所在frame
       * @property {Object} event 事件对象的部分属性
       * @property {Object} target event.taget.target的部分属性
       */
      this.emit("dom-event", payload)
    })

    // hash变化时需要更新url
    this.ipc.on("frame.hashchange", (payload) => {
      if (payload.isMainFrame) {
        this._url = payload.url
      }
    })
  }
  // 绑定右键菜单
  _bindContextMenu() {
    contextMenu({
      prepend: (defaultActions, params) => [
        {
          label: "在新标签页中打开链接",
          visible: params.linkURL.length !== 0 && params.mediaType === "none",
          click: () => {
            this.browser().newPage(params.linkURL, {referrer: this.url()})
          },
        },
      ],
      window: this.webview,
      showSearchWithGoogle: false,
      showSaveImageAs: true,
      showCopyImageAddress: true,
      // 转中文
      labels: {
        cut: "剪切",
        copy: "复制",
        paste: "粘贴",
        copyLink: "复制链接地址",
        copyImage: "复制图片",
        copyImageAddress: "复制图片地址",
        saveImageAs: "图片存储为…",
        inspect: "检查",
      },
    })
  }
  _onCrashed() {
    this.isCrashed = true
    if (this.$dom) {
      let crashedDOM = document.createElement("div")
      crashedDOM.innerHTML =
        '<div style="width: 100%; position: absolute; left: 0; top: 0; height: 100%; z-index: 2; background: #fff; padding: 100px; font-size: 24px; color: #444; line-height: 32px; "><svg t="1598317803345" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2065" width="32" height="32" style=" margin-right: 20px; display: inline-block; vertical-align: top; "><path d="M1024 519.9872C1024 484.4544 984.9344 0 506.2656 0 79.36 0 0 433.0496 0 522.5984c0 323.2768 298.24 372.8384 298.24 372.8384-16.2304 86.528 43.1616 147.0464 137.3696 103.936 77.056 52.8896 132.352 4.096 132.352 4.096 62.464 34.5088 158.6688-7.1168 145.152-108.9536 0 0 310.8864-63.0784 310.8864-374.4768M299.008 649.216c-78.8992 0-142.8992-75.9808-142.8992-169.7792 0-93.696 64-169.6768 142.848-169.6768 79.0016 0 143.0016 75.9296 143.0016 169.6768 0 93.7984-64 169.8304-142.9504 169.8304m275.7632 87.808c-3.072 58.112-101.7344 77.1072-112.1792 0-1.1264-15.9744 13.568-77.312 56.064-77.312 42.4448 0 58.9824 58.2656 56.1152 77.1584m150.016-87.6544c-78.9504 0-142.9504-76.032-142.9504-169.8304 0-93.696 64-169.6768 143.0016-169.6768 78.9504 0 142.9504 75.9296 142.9504 169.6768 0 93.7984-64 169.8304-142.9504 169.8304" p-id="2066" fill="currentColor"></path></svg>喔唷，崩溃啦！</div>'
      this.$dom.appendChild(crashedDOM)
    } else {
    }
  }
  _onDestroyed() {
    this.isDestroyed = true
  }
  goHome() {
    return this.goto(this.options.startUrl || "about:blank")
  }
  // 不可直接调用
  // 取消激活
  _doBack() {
    this.isFront = false
    if (this.$dom) {
      this.$dom.style.display = "none"
    }

    /**
     * 当前page取消激活时触发
     * @event Page#back
     */
    this.emit("back")
  }
  // 不可直接调用
  // 激活
  _doFront() {
    this.isFront = true
    if (this.$dom) {
      this.$dom.style.display = "flex"
    }

    /**
     * 当前page激活时触发
     * @event Page#front
     */
    this.emit("front")
  }
  /**
   * 是否在loading状态
   *
   * @return {boolean}
   */
  isLoading() {
    return this.webview.isLoading()
  }
  /**
   * 主页面是否在loading状态
   *
   * @return {boolean}
   */
  isLoadingMainFrame() {
    return this.webview.isLoadingMainFrame()
  }
  /**
   * 激活当前页面
   *
   * @return {Promise<this>}
   */
  async bringToFront() {
    if (!this.isFront) {
      this._browser._bringPageToFront(this.id)
    }
    return this
  }
  /**
   * 获取当前page所属的browser
   *
   * @return {Browser}
   */
  browser() {
    return this._browser
  }
  _removeWebview() {
    this.container.removeChild(this.$dom)
  }
  /**
   * 关闭当前page
   *
   * @return {Browser}
   */
  close() {
    this.closed = true
    this._removeWebview()
    this._browser._removePage(this.id)

    /**
     * 当前page关闭时触发
     * @event Page#close
     */
    this.emit("close")

    setTimeout(() => this.removeAllListeners(), 0)
  }
  /**
   * 获取制定name的cookie
   * @param {string|Object} [filterOrName] string类型为cookie名称，Object类型为过滤条件，支持url,name、domain，path, secure
   *
   * @return {Cookie} 返回第一个Cookie信息
   */
  cookie(filterOrName) {
    return this.session.cookies
      .get(isString(filterOrName) ? {name: filterOrName} : filterOrName || {})
      .then((cookiesArray) => [].concat(cookiesArray).shift())
  }
  /**
   * 获取指定多个url下的cookie数据
   * @param {string[]} urls url集合
   *
   * @return {Cookie[]} Cookie信息集合
   */
  cookies(urls) {
    return Promise.all(
      urls.map((url) => this.session.cookies.get({url}))
    ).then((cookiesArray) => [].concat(...cookiesArray))
  }
  /**
   * 删除cookie
   * 和puppeteer区别的是只支持url和name属性
   * @param  {...Cookie} cookies 要删除的cookie属性
   * @property {string} Cookie.url 与cookie关联的 URL
   * @property {string} Cookie.name cookie名称
   *
   */
  deleteCookies(...cookies) {
    return Promise.all(
      cookies.map((cookie) =>
        this.session.cookies.remove(cookie.url, cookie.name)
      )
    )
  }
  /**
   * 获取当前page下的所有frame集合，包含mainFrame和iframe
   *
   * @return {Frame[]}
   */
  frames() {
    // 递归挂载父的frame信息
    const mountParent = (info) => {
      if (info.isMainFrame) {
        info.parent = null
      } else {
        let parent = this._frames.find((item) => item.UUID === info.parentUUID)
        info.parent = parent && mountParent(parent)
      }

      return info
    }

    return this._frames.map(
      (info) => new Frame(this, this.webview, mountParent(info))
    )
  }
  /**
   * 当前page是否可后退
   *
   * @return {boolean}
   */
  canGoBack() {
    if (
      this.isDestroyed ||
      this.isCrashed ||
      !this.isReady ||
      (!this.isBrowserPage && !document.body.contains(this.webview))
    ) {
      return false
    }
    return this.webview.canGoBack()
  }
  /**
   * 当前page是否可前进
   *
   * @return {boolean}
   */
  canGoForward() {
    if (this.isDestroyed || this.isCrashed || !this.isReady) {
      return false
    }
    return this.webview.canGoForward()
  }
  /**
   * page后退
   *
   * @return {undefined}
   */
  goBack() {
    return this.webview.goBack()
  }
  /**
   * page前进
   *
   * @return {undefined}
   */
  goForward() {
    return this.webview.goForward()
  }
  /**
   * 当前page是否关闭
   *
   * @return {boolean}
   */
  isClosed() {
    return this.closed
  }
  /**
   * 获取mainFrame
   *
   * @return {Frame}
   */
  mainFrame() {
    return this._mainFrame
  }
  /**
   * 搜索页面内是否存在指定文本
   * @param {string} text 要搜索的文本
   *
   * @return {Promise<boolean>}
   */
  find(text) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        onFound({})
      }, 500)

      const onFound = ({result}) => {
        clearTimeout(timeout)
        this.webview.removeEventListener("found-in-page", onFound)
        this.webview.stopFindInPage("clearSelection")
        resolve(result && result.matches > 0)
      }
      this.webview.addEventListener("found-in-page", onFound)
      this.webview.findInPage(text, {
        matchCase: true,
      })
    })
  }
  /**
   * 刷新页面
   * 暂不支持options
   */
  reload() {
    if (this.isCrashed) {
      return Promise.resolve(this.webview.reload())
    }

    return this.goto(this.url(), {reload: true})
  }
  /**
   * 指定区域的截图
   * 调用webview.capturePage
   *
   * @async
   * @param {Object} options
   * @param {String}} [options.path] 文件保存路径, 不传则不会保存到硬盘
   * @param {String}} [options.type] 文件类型 [png/jpeg] 默认：png
   * @param {Object} options.clip 指定裁剪区域 x, y, width, height属性[int类型]
   *
   * @return {string|Buffer}
   */
  async screenshot({path, type, clip}) {
    type = type || "png"

    let nativeImage = await this.webview.capturePage(clip)
    let size = nativeImage.getSize()
    // macos上默认是@2x的图片
    if (size.width !== clip.width) {
      nativeImage = nativeImage.resize({
        width: clip.width,
        height: clip.height,
      })
    }

    let method = "to" + type.toLocaleUpperCase()
    let buffer = nativeImage[method]()
    if (path) {
      fs.writeFileSync(path, buffer)
      return path
    }

    return buffer
  }
  /**
   * 设置cookie
   * @param  {...Cookie} cookies
   *
   * @return {Promise}
   */
  setCookie(...cookies) {
    return Promise.all(
      cookies.map((cookie) => this.session.cookies.set(cookie))
    )
  }
  /**
   * 清除历史记录
   *
   * @return Promise<boolean> 返回是否操作成功
   */
  clearHistory() {
    return new Promise((resolve) => {
      let times = 0
      let interval = setInterval(() => {
        if (!this.isLoadingMainFrame) {
          clearInterval(interval)
          this.webview.clearHistory()
          resolve(true)
        }

        if (times++ >= 20) {
          clearInterval(interval)
          resolve(false)
        }
      }, 500)
    })
  }
  /**
   * 等待页面发起指定请求
   * @param {string|Function} urlOrPredicate url或者断定函数
   * @param {Object} options 配置
   *
   * @return {Promise<Request>}
   */
  waitForRequest(urlOrPredicate, options) {
    if (["string", "function"].indexOf(typeof urlOrPredicate) === -1) {
      return Promise.reject("urlOrPredicate must be string or Function")
    }

    return new TimeoutPromise((resolve) => {
      this.networkManager.on("request", (request) => {
        if (typeof urlOrPredicate === "string") {
          if (request.url() === urlOrPredicate) {
            resolve(request)
          }
        } else {
          if (urlOrPredicate(request)) {
            resolve(request)
          }
        }
      })
    }, (options && options.timeout) || 1e4)
  }
  /**
   * 等待页面的指定请求返回
   * @param {string|Function} urlOrPredicate url或者断定函数
   * @param {Object} options 配置
   *
   * @return {Promise<Response>}
   */
  waitForResponse(urlOrPredicate, options) {
    if (["string", "function"].indexOf(typeof urlOrPredicate) === -1) {
      return Promise.reject("urlOrPredicate must be string or Function")
    }

    return new TimeoutPromise((resolve) => {
      this.networkManager.on("response", (response) => {
        if (typeof urlOrPredicate === "string") {
          if (response.url() === urlOrPredicate) {
            resolve(response)
          }
        } else {
          if (urlOrPredicate(response)) {
            resolve(response)
          }
        }
      })
    }, (options && options.timeout) || 1e4)
  }
  /**
   * todo
   *
   * @return {Promise<never>}
   */
  evaluateHandle() {
    return Promise.reject("todo")
  }
  /**
   * todo
   *
   * @return {Promise<never>}
   */
  queryObjects() {
    return Promise.reject("todo")
  }
  _setTarget(target) {
    this._target = target
  }
  /**
   * 返回当前页面的target
   */
  target() {
    return this._target
  }
  /**
   * preload里的windowProxy处理
   * @param {string} proxyId 代理id
   * @param {Page} openerPage 调用window.open打开当前页面的page
   */
  _initWindowProxy(proxyId, openerPage) {
    this.on("connect", ({url}) => {
      openerPage.ipc.send("windowProxy.location.change", {
        proxyId,
        url,
      })
    })

    this.on("close", () => {
      openerPage.ipc.send("windowProxy.closed.change", {
        proxyId,
        closed: true,
      })
    })

    openerPage.ipc.on("windowProxy.location", (payload) => {
      if (payload.proxyId === proxyId) {
        let url = new URL(this.url())
        if (payload.key in url) {
          url[payload.key] = payload.value
        }
        url = url.toString()

        this.goto(url, {retry: 1})

        return url
      }
    })

    openerPage.ipc.on("windowProxy.close", (payload) => {
      if (payload.proxyId === proxyId) {
        this.close()
      }
    })
  }
}

// webContents的消息参数映射为webview的addEventListener参数
const WEB_VIEW_EVENTS = {
  "load-commit": ["url", "isMainFrame"],
  "did-attach": [],
  "did-finish-load": [],
  "did-fail-load": [
    "errorCode",
    "errorDescription",
    "validatedURL",
    "isMainFrame",
    "frameProcessId",
    "frameRoutingId",
  ],
  "did-frame-finish-load": ["isMainFrame", "frameProcessId", "frameRoutingId"],
  "did-start-loading": [],
  "did-stop-loading": [],
  "dom-ready": [],
  "console-message": ["level", "message", "line", "sourceId"],
  "context-menu": ["params"],
  "devtools-opened": [],
  "devtools-closed": [],
  "devtools-focused": [],
  "new-window": ["url", "frameName", "disposition", "options"],
  "will-navigate": ["url"],
  "did-start-navigation": [
    "url",
    "isInPlace",
    "isMainFrame",
    "frameProcessId",
    "frameRoutingId",
  ],
  "did-navigate": ["url", "httpResponseCode", "httpStatusText"],
  "did-frame-navigate": [
    "url",
    "httpResponseCode",
    "httpStatusText",
    "isMainFrame",
    "frameProcessId",
    "frameRoutingId",
  ],
  "did-navigate-in-page": [
    "url",
    "isMainFrame",
    "frameProcessId",
    "frameRoutingId",
  ],
  "focus-change": ["focus", "guestInstanceId"],
  "close": [],
  "crashed": [],
  "plugin-crashed": ["name", "version"],
  "destroyed": [],
  "page-title-updated": ["title", "explicitSet"],
  "page-favicon-updated": ["favicons"],
  "enter-html-full-screen": [],
  "leave-html-full-screen": [],
  "media-started-playing": [],
  "media-paused": [],
  "found-in-page": ["result"],
  "did-change-theme-color": ["themeColor"],
  "update-target-url": ["url"],

  "ipc-message": ["channel", "...args"],
}

/**
 * @class WindowPage
 * @extends Page
 * 由window.open弹窗打开的browserWindow实例，也作为page页面
 *
 */
class WindowPageClass extends Page {
  constructor(browser, options, win) {
    super(browser, options)
    this.isBrowserPage = true
    this.win = win

    this._relayWebContentsEvents = []
    this._handleRelayEventBinderCache = {}
  }
  // 将browserWindow装饰为webview
  _createWebview() {
    let webContents = this.win.webContents
    let _this = this
    this.isReady = true
    this.webContentsId = webContents.id
    this.webContents = webContents
    return new Proxy(webContents, {
      get(obj, key) {
        switch (key) {
          case "isBrowserWindow":
            return true
          case "getWebContentsId":
            return () => webContents.id
          case "addEventListener":
            return _this._relayWebContentsEventToDomEvent.bind(
              _this,
              webContents
            )
          case "removeEventListener":
            return _this._unrelayWebContentsEventToDomEvent.bind(
              _this,
              webContents
            )
          default:
            return obj[key]
        }
      },
      set(obj, key, value) {
        return (obj[key] = value)
      },
    })
  }
  _removeWebview() {
    this.win.destroy()
  }
  // browserWindow的frame.register会丢失，需要在实例化的时候补发
  _reissueRegisterMessage(registerInfo) {
    this.ipc.dispatch("frame.register", registerInfo)
    this.ipc.dispatch("frame.hashchange", registerInfo)
  }
  // 将消息转为dom事件
  _relayWebContentsEventToDomEvent(webContents, evtName, listener) {
    if (!this._relayWebContentsEvents.some((item) => item[0] === evtName)) {
      this._handleRelayEventBinderCache = this._handleRelayEventBinderCache
      // 缓存handler，用于取消监听
      let handler = (this._handleRelayEventBinderCache[
        evtName
      ] = this._handleRelayEvent.bind(this, evtName))
      webContents.on(evtName, handler)
    }
    this._relayWebContentsEvents.push([evtName, listener])
  }
  _unrelayWebContentsEventToDomEvent(evtName, listener) {
    this._relayWebContentsEvents = this._relayWebContentsEvents.filter(
      (item) => evtName === item[0] && (!listener || listener === item[1])
    )

    if (!this._relayWebContentsEvents.some((item) => item[0] === evtName)) {
      let handler = this._handleRelayEventBinderCache[evtName]
      delete this._handleRelayEventBinderCache[evtName]
      webContents.off(evtName, handler)
    }
  }
  _handleRelayEvent(evtName, _, ...args) {
    let domEvent = new Event(evtName)
    let evtPayloadFields = WEB_VIEW_EVENTS[evtName] || []

    evtPayloadFields.forEach((field, i) => {
      if (field.startsWith("...")) {
        domEvent[field.substr(3)] = args.slice(i)
      } else {
        domEvent[field] = args[i]
      }
    })

    for (let item of this._relayWebContentsEvents) {
      if (item[0] === evtName) {
        item[1].call(this.webview, domEvent)
      }
    }
  }
}

const proxyProperties = [
  /**
   * [page.mainFrame().document.$ 的简写]{@link ElementHandle#$}
   * @method Page#$
   */
  "$",
  /**
   * [page.mainFrame().document.$$ 的简写]{@link ElementHandle#$$}
   * @method Page#$$
   */
  "$$",
  /**
   * [page.mainFrame().document.$eval 的简写]{@link ElementHandle#$eval}
   * @method Page#$eval
   */
  "$eval",
  /**
   * [page.mainFrame().document.$$eval 的简写]{@link ElementHandle#$$eval}
   * @method Page#$$eval
   */
  "$$eval",
  /**
   * [page.mainFrame().document.$x 的简写]{@link ElementHandle#$x}
   * @method Page#$x
   */
  "$x",
  /**
   * [page.mainFrame().addScriptTag的简写]{@link Frame#addScriptTag}
   * @method Page#addScriptTag
   */
  "addScriptTag",
  /**
   * [page.mainFrame().addStyleTag的简写]{@link Frame#addStyleTag}
   * @method Page#addStyleTag
   */
  "addStyleTag",
  /**
   * [page.mainFrame().click的简写]{@link Frame#click}
   * @method Page#click
   */
  "click",
  /**
   * [page.mainFrame().content的简写]{@link Frame#content}
   * @method Page#content
   */
  "content",
  /**
   * [page.mainFrame().evaluate的简写]{@link Frame#evaluate}
   * @method Page#evaluate
   */
  "evaluate",
  /**
   * [page.mainFrame().focus的简写]{@link Frame#focus}
   * @method Page#focus
   */
  "focus",
  /**
   * [page.mainFrame().hover的简写]{@link Frame#hover}
   * @method Page#hover
   */
  "hover",
  /**
   * [page.mainFrame().goto的简写]{@link Frame#goto}
   * @method Page#goto
   */
  "goto",
  /**
   * [page.mainFrame().select的简写]{@link Frame#select}
   * @method Page#select
   */
  "select",
  /**
   * [page.mainFrame().setContent的简写]{@link Frame#setContent}
   * @method Page#setContent
   */
  "setContent",
  /**
   * [page.mainFrame().tap的简写]{@link Frame#tap}
   * @method Page#tap
   */
  "tap",
  /**
   * [page.mainFrame().title的简写]{@link Frame#title}
   * @method Page#title
   */
  "title",
  /**
   * [page.mainFrame().type的简写]{@link Frame#type}
   * @method Page#type
   */
  "type",
  /**
   * [page.mainFrame().press的简写]{@link Frame#press}
   * @method Page#press
   */
  "press",
  /**
   * [page.mainFrame().url的简写]{@link Frame#url}
   * @method Page#url
   */
  "url",
  /**
   * [page.mainFrame().waitFor的简写]{@link Frame#waitFor}
   * @method Page#waitFor
   */
  "waitFor",
  /**
   * [page.mainFrame().waitForFunction的简写]{@link Frame#waitForFunction}
   * @method Page#waitForFunction
   */
  "waitForFunction",
  /**
   * [page.mainFrame().waitForNavigation的简写]{@link Frame#waitForNavigation}
   * @method Page#waitForNavigation
   */
  "waitForNavigation",
  /**
   * [page.mainFrame().waitForNavigationOut的简写]{@link Frame#waitForNavigationOut}
   * @method Page#waitForNavigationOut
   */
  "waitForNavigationOut",
  /**
   * [page.mainFrame().waitForNavigationTo的简写]{@link Frame#waitForNavigationTo}
   * @method Page#waitForNavigationTo
   */
  "waitForNavigationTo",
  /**
   * [page.mainFrame().waitForSelector的简写]{@link Frame#waitForSelector}
   * @method Page#waitForSelector
   */
  "waitForSelector",
  /**
   * [page.mainFrame().hasElement的简写]{@link Frame#hasElement}
   * @method Page#hasElement
   */
  "hasElement",
  /**
   * [page.mainFrame().waitForXPath的简写]{@link Frame#waitForXPath}
   * @method Page#waitForXPath
   */
  "waitForXPath",
  /**
   * [page.mainFrame().localStorageKeys的简写]{@link Frame#localStorageKeys}
   * @method Page#localStorageKeys
   */
  "localStorageKeys",
  /**
   * [page.mainFrame().localStorageGet的简写]{@link Frame#localStorageGet}
   * @method Page#localStorageGet
   */
  "localStorageGet",
  /**
   * [page.mainFrame().localStorageSet的简写]{@link Frame#localStorageSet}
   * @method Page#localStorageSet
   */
  "localStorageSet",
  /**
   * [page.mainFrame().localStorageRemove的简写]{@link Frame#localStorageRemove}
   * @method Page#localStorageRemove
   *
   */
  "localStorageRemove",
]

export default proxyBindDecorator(proxyProperties, function () {
  return this._mainFrame
})(Page)

export const WindowPage = proxyBindDecorator(proxyProperties, function () {
  return this._mainFrame
})(WindowPageClass)
