import EventEmitter from "./EventEmitter.js"
import ElementHandle from "./ElementHandle.js"
import {BoundIpc} from "./ipc.js"
import {isFunction, TimeoutPromise, proxyBindDecorator} from "./util.js"

/**
 * @class Frame Frame类，webview的iframe，主页面是mainFrame
 * @extends EventEmitter
 *
 * @property {WebviewTag} webview
 * @property {boolean} isMainFrame 是否mainFrame
 * @property {Ipc} ipc ipc通信实例，可用于和webview内内容通信
 * @property {ElementHandle} document 当前frame的document操作句柄
 *
 */
class Frame extends EventEmitter {
  /**
   * @typedef FrameInfo frame信息
   * @property {string} FrameInfo.UUID iframe的UUID值
   * @property {string} FrameInfo.name iframe的name值
   * @property {boolean} FrameInfo.isMainFrame 是否为mainFrame
   * @property {FrameInfo} FrameInfo.parent 父的frame的信息
   */

  /**
   *
   * @constructor Frame
   * @param {Page} page 所属page实例
   * @param {WebviewTag} webviewElement webview节点
   * @param {FrameInfo} frameInfo frame的信息
   */
  constructor(page, webviewElement, frameInfo) {
    super()

    this._frameInfo = frameInfo
    this._url = frameInfo.url || ""

    this._page = page
    this.webview = webviewElement
    // webview的webContentsId
    this.webContentsId = frameInfo.webContentsId
    this.routingId = frameInfo.routingId
    this.isMainFrame = frameInfo.isMainFrame
    this.ipc = new BoundIpc(this.webview, frameInfo.UUID)
    this.document = new ElementHandle(this, "document", [])

    this._childFrames = []
    this._listenChildFramesRegister()
    this._listenChildFramesUnregister()
    this._listenFrameContentEvents()
  }
  // 监听当前frame下子iframe的注册事件
  _listenChildFramesRegister() {
    this.ipc.on("childFrame.register", (frameInfo) => {
      let originInfo = this._childFrames.find(
        (item) => item.UUID === frameInfo.UUID
      )
      if (originInfo) {
        Object.assign(originInfo, frameInfo)
      } else {
        this._childFrames.push(frameInfo)
      }
    })
  }
  // 监听当前frame下子iframe的注销事件
  _listenChildFramesUnregister() {
    this.ipc.on("childFrame.unregister", (frameInfo) => {
      this._childFrames = this._childFrames.filter(
        (item) => item.UUID !== frameInfo.UUID
      )
    })
  }
  _listenFrameContentEvents() {
    this.ipc.on("frame.event", (payload) => {
      /**
       * frame dom 事件
       * @event Page#dom-event
       * @type {Object}
       * @property {string} type 事件类型
       * @property {Object} event 事件对象的部分属性
       * @property {Object} target event.taget.target的部分属性
       */
      this.emit("dom-event", payload)
    })
  }
  /**
   * 注入一个指定url或(content)的script标签到页面
   * @param {Object} options
   * @property {string} [options.url] 要添加的script的src
   * @property {string} [options.content] 要注入页面的js代码
   * @property {boolean} [options.waitLoad] 如果是url，等待onload回调
   * @property {string} [options.type] type属性，如果要注入 ES6 module，值为'module'
   *
   * @return {Promise<ElementHandle>} 返回注入脚本的dom句柄实例
   */
  addScriptTag(options) {
    return this.ipc.send("frame.addScriptTag", options)
  }
  /**
   * 注入一个link(url)或style(content)标签到页面
   * @param {Object} options
   * @property {string} [options.id] 样式的id，相同id的style不会重复添加到页面
   * @property {string} [options.url] 要添加的css link的src
   * @property {string} [options.content] 要注入页面的style代码
   * @property {boolean} [options.force] 在id相同时强制重新添加style到页面
   *
   * @return {Promise<ElementHandle>} 返回注入样式的dom句柄实例
   */
  addStyleTag(options) {
    return this.ipc.send("frame.addStyleTag", options)
  }
  /**
   * 获取当前frame
   */
  childFrames() {
    return this._childFrames.map(
      (info) =>
        new Frame(this._page, this.webview, {
          ...info,
          parent: this._frameInfo,
        })
    )
  }
  /**
   * todo
   * 获取frame的内容
   *
   * @return {string}
   */
  content() {
    return this.ipc.send("frame.content")
  }
  /**
   * 在frame运行指定函数
   * @param {Function} pageFunction
   * @param {string[]|number[]} args 传给pageFunction的参数
   * @param {number|Object} [options]  等待超时时间
   *
   * @return {Promise<*>} 返回运行结果，若pageFunction返回Promise，会等待Promise的resolve结果
   */
  evaluate(pageFunction, args, options) {
    if (!Array.isArray(args)) {
      options = args
      args = []
    }
    let retry = 0
    let timeout = options
    let name = ""
    if (Object.prototype.toString.call(options) === "[object Object]") {
      retry = options.retry || 0
      timeout = options.timeout
      name = options.name
    }
    timeout = timeout || 1e4

    if (typeof pageFunction == "string") {
      pageFunction = "function() {return " + pageFunction + "}"
    }

    return this.ipc.send(
      "frame.evaluate",
      {pageFunction: pageFunction.toString(), args: args, name: name},
      timeout,
      retry
    )
  }
  /**
   * 控制当前frame跳转到指定url
   * 会在超时时间内追踪重定向，直到跳转到最终页面
   * @param {string} url
   * @param {Object} [options]
   * @property {string} [options.waitUntil] 认定跳转成功的事件类型 load|domcontentloaded|hashchange|historyNavigation，默认为domcontentloaded
   * @property {boolean} [options.reload] 刷新
   * @property {number} [options.timeout] 超时时间，单位为ms，默认为10000ms
   * @property {number} [options.retry] 重试次数，默认不重试, 重试仅在发送超时的情况
   *
   * @return {Promise<undefined>}
   */
  async goto(url, options) {
    let timeout = (options && options.timeout) || 1e4
    var waitUntil = (options && options.waitUntil) || "domcontentloaded"

    // 递归获取最终的跳转地址
    // timeout计时结束后就停止监听跳转
    var redirectURL = url
    const _getRedirectUrl = () => {
      this.page().webRequest.onBeforeRedirect(
        {
          urls: ["http://*/*", "https://*/*"],
        },
        (details) => {
          if (details.url === redirectURL) {
            redirectURL = details.redirectURL
            // console.log('onBeforeRedirect: ', redirectURL)
          }
        }
      )
    }
    _getRedirectUrl()

    await this.ipc.send("frame.goto", {
      url: url,
      reload: options && options.reload,
    })

    return new TimeoutPromise((resolve) => {
      this.ipc.on("frame.goto." + waitUntil, (payload) => {
        if (
          (redirectURL.startsWith("/") && payload.relative === redirectURL) ||
          (redirectURL.startsWith("?") && payload.query === redirectURL) ||
          (redirectURL.startsWith("#") &&
            (payload.hash === redirectURL ||
              payload.hash.split("?").shift())) ||
          payload.url === redirectURL
        ) {
          resolve(payload)
        }
      })
    }, timeout).catch((err) => {
      if (err === "promise.timeout") {
        if (!options || !options.retry || options.retry <= 0) {
          return Promise.reject("goto.timeout")
        } else {
          return this.goto(url, {
            ...options,
            retry: options.retry - 1,
          })
        }
      }
      return Promise.reject(err)
    })
  }
  /**
   * todo
   */
  isDetached() {
    return Promise.reject("todo")
  }
  /**
   * frame的名称
   *
   * @return {string}
   */
  name() {
    return this._frameInfo.name
  }
  /**
   * frame所属的page实例
   *
   * @return {Page}
   */
  page() {
    return this._page
  }
  /**
   * frame的parentFrame
   * 如果当前frame为mainFrame，返回null
   *
   * @return {Frame}
   */
  parentFrame() {
    if (this._frameInfo.parent) {
      return new Frame(this._page, this.webview, this._frameInfo.parent)
    }
    return null
  }
  /**
   * todo
   */
  select() {
    return Promise.reject("todo")
  }
  /**
   * todo
   * 设置页面内容
   * @param {string} html
   *
   * @return {Promise<undefined>}
   */
  setContent(html) {
    return this.ipc.send("frame.setContent", html)
  }
  /**
   * frame的标题
   *
   * @return {string}
   */
  title() {
    if (this.isMainFrame) {
      return this.webview.getTitle()
    }

    return this.ipc.send("frame.title")
  }
  /**
   * 输入指定内容
   * @param {string} selector 要输入的dom的选择，input或textarea
   * @param {string} text 输入的文本
   * @param {Object} [options]
   * @property {number} [options.delay] 延迟输入, 操作更像用户
   */
  type(selector, text, options) {
    return this.document.$(selector).type(text, options)
  }
  /**
   * 输入指定内容
   * @param {string} selector 要输入的dom的选择，input或textarea
   * @param {string} press 输入的文本
   * @param {Object} [options]
   */
  press(selector, text, options) {
    return this.document.$(selector).press(text, options)
  }
  /**
   * 获取url，如果是mainFrame为当前url，如果是iframe，则是src属性
   *
   * @return {string}
   */
  url() {
    let url
    if (this.isMainFrame) {
      try {
        if (!this.webview.isCrashed()) {
          url = this.webview.getURL()
        }
      } catch {}
    }
    return url || this._frameInfo.url
  }
  /**
   * waitForSelector|waitForFunction|setTimeout的结合体
   * @param {string|number|Function} selectorOrFunctionOrTimeout
   * @param {Object} options
   * @param  {...any} args
   */
  waitFor(selectorOrFunctionOrTimeout, options, ...args) {
    if (typeof selectorOrFunctionOrTimeout === "string") {
      return this.waitForSelector(selectorOrFunctionOrTimeout, options)
    } else if (typeof selectorOrFunctionOrTimeout === "number") {
      return new Promise((resolve) => {
        setTimeout(resolve, selectorOrFunctionOrTimeout)
      })
    } else {
      return this.waitForFunction(selectorOrFunctionOrTimeout, options, ...args)
    }
  }
  /**
   * 在指定时间内轮询执行方法，直到方法返回true
   * @param {Function} pageFunction
   * @param {Object} [options]
   * @property {number} [options.timeout] 等待时间
   * @property {number} [options.retry] 重试次数，默认不重试, 重试仅在发送超时的情况
   * @param  {...any} args
   *
   * @return {Promise<boolean>} 成功返回resove(true)，超时返回reject
   */
  waitForFunction(pageFunction, options, ...args) {
    if (typeof pageFunction == "string") {
      pageFunction = "function() {return " + pageFunction + "}"
    }

    return this.ipc.send(
      "frame.waitForFunction",
      {
        pageFunction: pageFunction.toString(),
        args: args,
        options,
      },
      options && options.timeout,
      options && options.retry
    )
  }
  /**
   * 等待跳转完成
   * @param {Object} [options]
   * @property {string} [options.waitUntil] 认定跳转成功的事件类型 load|domcontentloaded|historyNavigation，默认为domcontentloaded
   * @property {number} [options.timeout] 超时时间，单位为ms，默认为10000ms
   *
   * @return {Promise<Object>} 返回跳转后frame的信息
   */
  waitForNavigation(options) {
    return new TimeoutPromise((resolve) => {
      var waitUntil = (options && options.waitUntil) || "domcontentloaded"
      this.ipc.once("frame.waitForNavigation." + waitUntil, function (param) {
        resolve(param)
      })
    }, (options && options.timeout) || 1e4).catch((err) => {
      if (err === "promise.timeout") {
        return Promise.reject("waitForNavigation.timeout")
      }
      return Promise.reject(err)
    })
  }
  /**
   * 等待url跳出，不会等待跳转的页面的加载事件
   * @param {Object} [options]
   * @property {string|Function} [options.url] 要跳出的url|检查当前url和跳出url是否匹配的函数
   * @property {number} [options.timeout] 超时时间，单位为ms，默认为10000ms
   *
   * @return {Promise<boolean>}
   */
  waitForNavigationOut(options) {
    if (!options || !options.url) {
      return Promise.reject("options.url cannot empty")
    }

    let timeout = options.timeout || 1e4
    return Promise.race([
      this.waitForNavigation({
        timeout: timeout,
      }),
      new Promise((resolve, reject) => {
        let start = Date.now()
        let t = setInterval(() => {
          if (Date.now() - start >= timeout) {
            clearInterval(t)
            reject("waitForNavigationOut.timeout")
          }

          if (
            (isFunction(options.url) && !options.url(this.url())) ||
            !this.url().startsWith(options.url)
          ) {
            clearInterval(t)
            resolve(true)
          }
        }, 100)
      }),
    ])
  }
  /**
   * 等待url跳入，不会等待跳入页面的加载事件
   * @param {Object} [options]
   * @property {string|Function} [options.url] 要跳入的url|检查当前url和跳入url是否匹配的函数
   * @property {number} [options.timeout] 超时时间，单位为ms，默认为10000ms
   *
   * @return {Promise<boolean>}
   */
  waitForNavigationTo(options) {
    if (!options || !options.url) {
      return Promise.reject("options.url cannot empty")
    }

    let timeout = options.timeout || 1e4
    return new Promise((resolve, reject) => {
      let start = Date.now()
      let t = this.setInterval(() => {
        if (Date.now() - start >= timeout) {
          clearInterval(t)
          reject("waitForNavigationTo.timeout")
        }

        if (
          (isFunction(options.url) && options.url(this.url())) ||
          this.url().startsWith(options.url)
        ) {
          clearInterval(t)
          resolve(true)
        }
      }, 100)
    })
  }
  /**
   * 在指定时间内轮询查询dom节点，直到查找到节点
   * @param {string} selector dom节点选择器
   * @param {Object} [options]
   * @property {boolean} [options.visible] 节点是否可见，如果visible为true时必须查到到dom节点且可见才会返回true
   * @property {number} [options.timeout] 超时时间，单位为ms，默认为10000ms
   * @property {number} [options.retry] 重试次数，默认不重试, 重试仅在发送超时的情况
   *
   * @return {Promise<undefined>} 成功则resolve，失败返回reject
   */
  waitForSelector(selector, options) {
    return this.ipc.send(
      "frame.waitForSelector",
      {
        selector: selector,
        options: options,
      },
      options && options.timeout,
      options && options.retry
    )
  }
  /**
   * 在指定时间内轮询查询dom节点，查找到节点返回true，否则返回false
   * @param {string} selector dom节点选择器
   * @param {Object} options 和waitForSelector的options相同
   *
   * @return {Promise<boolean>}
   */
  hasElement(selector, options) {
    return this.waitForSelector(selector, options).then(
      () => true,
      () => false
    )
  }
  /**
   * todo
   */
  waitForXPath(/* xpath, options */) {
    return Promise.reject("todo")
  }
  /**
   * 点击frame内的指定节点
   * @param {string} selector 选择器
   * @param {Object} options 暂不支持
   *
   * @return {Promise<boolean>}
   */
  click(selector, options) {
    return this.document.$(selector).click(options)
  }
  /**
   * 聚焦frame内的指定节点
   * @param {string} selector 选择器
   * @param {Object} options 暂不支持
   *
   * @return {Promise<boolean>}
   */
  focus(selector, options) {
    return this.document.$(selector).focus(options)
  }
  /**
   * 取消聚焦frame内的指定节点
   * @param {string} selector 选择器
   * @param {Object} options 暂不支持
   *
   * @return {Promise<boolean>}
   */
  blur(selector, options) {
    return this.document.$(selector).blur(options)
  }
  /**
   * 鼠标移入frame内的指定节点，对应mouseover事件
   * @param {string} selector 选择器
   * @param {Object} options 暂不支持
   *
   * @return {Promise<boolean>}
   */
  hover(selector, options) {
    return this.document.$(selector).hover(options)
  }
  /**
   * todo
   */
  tap(selector, options) {
    return this.document.$(selector).tap(options)
  }
  /**
   * 获取localStorage的所有key集合
   */
  localStorageKeys() {
    return this.ipc.send("frame.localStorageKeys", null, 1e4, 2)
  }
  /**
   * localStorage.getItem
   * @param {string} key
   *
   * @return {Promise<string>}
   */
  localStorageGet(key) {
    return this.ipc.send(
      "frame.localStorageGet",
      {
        key: key,
      },
      1e4,
      2
    )
  }
  /**
   * localStorage.setItem
   * @param {string} key
   * @param {string} value
   *
   * @return {Promise<undefined>}
   */
  localStorageSet(key, value) {
    return this.ipc.send(
      "frame.localStorageSet",
      {
        key: key,
        value: value,
      },
      1e4,
      2
    )
  }
  /**
   * localStorage.removeItem
   * @param {string} key
   *
   * @return {Promise<undefined>}
   */
  localStorageRemove(key) {
    return this.ipc.send(
      "frame.localStorageRemove",
      {
        key: key,
      },
      1e4,
      2
    )
  }
}

export default proxyBindDecorator(
  [
    /**
     * [frame.document.$的简写]{@link ElementHandle#$}
     * @method Frame#$
     */
    "$",
    /**
     * [frame.document.$$的简写]{@link ElementHandle#$$}
     * @method Frame#$$
     */
    "$$",
    /**
     * [frame.document.$eval的简写]{@link ElementHandle#$eval}
     * @method Frame#$eval
     */
    "$eval",
    /**
     * [frame.document.$$eval的简写]{@link ElementHandle#$$eval}
     * @method Frame#$$eval
     */
    "$$eval",
    /**
     * [frame.document.$x的简写]{@link ElementHandle#$x}
     * @method Frame#$x
     */
    "$x",
  ],
  function () {
    return this.document
  }
)(Frame)
