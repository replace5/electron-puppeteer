"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; }; /**
                                                                                                                                                                                                                                                                   * @file Page Page类
                                                                                                                                                                                                                                                                   */

var _EventEmitter = require("./EventEmitter.js");

var _EventEmitter2 = _interopRequireDefault(_EventEmitter);

var _Frame = require("./Frame.js");

var _Frame2 = _interopRequireDefault(_Frame);

var _util = require("./util.js");

var _ipc = require("./ipc.js");

var _styleCss = require("./style.css.js");

var _styleCss2 = _interopRequireDefault(_styleCss);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

(0, _util.importStyle)(_styleCss2.default);

var _require = require("electron");

const remote = _require.remote;

const contextMenu = require("electron-context-menu");

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
 * @property {Array} shortcuts 快捷键配置，由Browser注入
 * @property {Object} options 传入的配置信息
 *
 */
class Page extends _EventEmitter2.default {
  /**
   * Page构造函数
   * @constructor Page
   *
   * @param {Browser} browser
   * @param {PageOptions} options 传入配置
   * @param {Element} options.container DOM容器
   * @param {boolean} [options.devtools] 是否打开控制台
   * @param {string} [options.partition] session标识，相同的partition共享登录状态
   * @param {number} [options.loadingTimeout] 页面加载超时时间, 默认10s
   * @param {string} [options.startUrl] 初始页面
   * @param {string} [options.startUrlReferrer] startUrl的referrer
   * @param {string} options.preload preload的脚本路径, 理论上必须为当前包的preload/webivew.preload.js
   * @param {string} [options.webpreferences] 网页功能的设置
   *
   */
  constructor(browser, options) {
    super();

    this._browser = browser;
    this.id = (0, _util.uniqueId)("page_");
    this.options = options;
    this.closed = false;
    this.isFront = false;
    this.isReady = false;
    this.container = options.container;
    this._frames = [];
    this._target = null;
  }
  /**
   * 初始化函数
   *
   * @return {Promise<undefined>}
   */
  init() {
    this.build();
    this._mainFrame = new _Frame2.default(this, this.webview, {
      UUID: "~",
      routingId: this.webContentsId,
      isMainFrame: true
    });
  }
  /**
   * 构建函数
   *
   * @return {Promise<undefined>}
   */
  build() {
    var _options = this.options;
    const startUrl = _options.startUrl,
          startUrlReferrer = _options.startUrlReferrer,
          preload = _options.preload,
          webpreferences = _options.webpreferences;

    const partition = this.options.partition;

    const webview = document.createElement("webview");
    webview.partition = partition;
    if (startUrlReferrer) {
      webview.httpreferrer = startUrlReferrer;
    }
    webview.src = startUrl || "about:blank";
    webview.nodeintegrationinsubframes = true;
    webview.nodeintegration = false;
    webview.preload = preload;
    webview.webpreferences = webpreferences;
    this.container.appendChild(webview);

    this.webview = webview;
    this.session = remote.session.fromPartition(partition);
    this.webRequest = this.session.webRequest;

    this.ipc = new _ipc.BoundIpc(webview, "*");
    this._listenFramesRegister();
    this._listenFramesUnregister();
    this._bindWebviewEvent();
    this._bindIPCEvent();

    webview.addEventListener("dom-ready", () => {
      /**
       * 页面的dom加载完毕
       * @event Page#dom-ready
       * @type {Object}
       * @property {string} url 页面url
       */
      this.emit("dom-ready", { url: this.url() });

      if (!this.isReady) {
        this.isReady = true;
        if (this.options.devtools) {
          webview.openDevTools();
        }
        this._bindContextMenu();
      }
    });
  }
  _waitForReady() {
    return new _util.TimeoutPromise(resolve => {
      if (this.isReady) {
        resolve(true);
      } else {
        this.webview.addEventListener("dom-ready", resolve);
      }
    }, this.options.loadingTimeout || 1e4);
  }
  // 监听页面的iframe的注册事件
  _listenFramesRegister() {
    this.ipc.on("frame.register", frameInfo => {
      if (!frameInfo.isMainFrame) {
        let originInfo = this._frames.find(item => item.UUID === frameInfo.UUID);
        if (originInfo) {
          Object.assign(originInfo, frameInfo);
        } else {
          this._frames.push(frameInfo);
        }

        let originRouting = this._frames.find(item => item.routingId === frameInfo.routingId);
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
        this.emit(originRouting ? "framenavigated" : "frameattached", frameInfo);
      } else {
        // mainFrame的_webContentsId
        this.webContentsId = frameInfo.routingId;
        if (this._mainFrame) {
          this._mainFrame.webContentsId = frameInfo.routingId;
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
          url: frameInfo.url
        });
      }
      this.emit("frame.register", frameInfo);
    });
  }
  // 监听页面的iframe的注销事件
  _listenFramesUnregister() {
    this.ipc.on("frame.unregister", frameInfo => {
      if (!frameInfo.isMainFrame) {
        this._frames = this._frames.filter(item => item.UUID !== frameInfo.UUID);

        /**
         * 当iframe被删除时触发
         * @event Page#framedetached
         * @type {Object}
         * @property {string} name iframe的name
         * @property {string} url iframe的url
         */
        this.emit("framedetached", frameInfo);
      } else {
        /**
         * 当页面断开连接时触发
         * @event Page#disconnect
         * @type {Object}
         * @property {string} url 当前页面的url
         */
        this.emit("disconnect", {
          url: frameInfo.url
        });
      }
    });
  }
  // 转发webview的dom事件
  _proxyDOMEvent(originName, emitName, modifyEvent, isMainFrame) {
    this.webview.addEventListener(originName, evt => {
      if (!isMainFrame || evt.isMainFrame) {
        modifyEvent && modifyEvent(evt);
        this.emit(emitName, evt);
      }
    });
    return this;
  }
  // 转发ipc事件
  _prxoyIPCEvent(originName, emitName, modifyPayload, isMainFrame, notMainFrame) {
    this.ipc.on(originName, payload => {
      if (payload && (!isMainFrame || payload.isMainFrame) && (!notMainFrame || !payload.isMainFrame)) {
        modifyPayload && modifyPayload(payload);
        this.emit(emitName, payload);
      }
    });
    return this;
  }
  // 需要绑定的快捷键
  _injectShortcuts(shortcuts) {
    this.shortcuts = shortcuts;
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

    this._proxyDOMEvent("did-start-loading", "load-start")._proxyDOMEvent("did-fail-load", "load-fail")._proxyDOMEvent("did-stop-loading", "load-end")._proxyDOMEvent("did-finish-load", "load-end")._proxyDOMEvent("did-frame-finish-load", "load-end", null, true)._proxyDOMEvent("page-title-updated", "title-updated")._proxyDOMEvent("favicon-updated", "favicon-updated", evt => {
      evt.favicon = evt.favicons.pop();
    })._proxyDOMEvent("console-message", "console")._proxyDOMEvent("new-window", "new-window");
  }
  // 监听ipc事件
  _bindIPCEvent() {
    /**
     * iframe onload时触发
     * @event Page#load
     * @type {Object}
     * @property {string} name iframe的name
     * @property {string} url iframe的url
     */

    /**
     * iframe domcontentloaded时触发
     * @event Page#domcontentloaded
     * @type {Object}
     * @property {string} name iframe的name
     * @property {string} url iframe的url
     */

    this._prxoyIPCEvent("page.title", "title-updated")._prxoyIPCEvent("page.favicon", "favicon-updated")._prxoyIPCEvent("frame.load", "load", null, true)._prxoyIPCEvent("frame.domcontentloaded", "domcontentloaded", null, true);

    // iframe和页面加载完成后会请求快捷键
    this.ipc.on("page.shortcuts.call", () => {
      return (this.shortcuts || []).map(item => _extends({}, item, { callback: null }));
    });
    // 监听快捷键绑定回复
    this.ipc.on("page.shortcuts.trigger", payload => {
      ;(this.shortcuts || []).map(item => {
        if (item.action && payload.action === item.action || item.keys.toString() === payload.keys.toString()) {
          item.callback.call(this);
        }
      });
    });
  }
  // 绑定右键菜单
  _bindContextMenu() {
    contextMenu({
      prepend: (defaultActions, params) => [{
        label: "Open Link in new Tab",
        visible: params.linkURL.length !== 0 && params.mediaType === "none",
        click: () => {
          this.browser().newPage(params.linkURL, this.url());
        }
      }],
      window: this.webview
    });
  }
  // 不可直接调用
  // 取消激活
  _doBack() {
    this.isFront = false;
    this.webview.style.display = "none";

    /**
     * 当前page取消激活时触发
     * @event Page#back
     */
    this.emit("back");
  }
  // 不可直接调用
  // 激活
  _doFront() {
    this.isFront = true;
    this.webview.style.display = "flex";

    /**
     * 当前page激活时触发
     * @event Page#front
     */
    this.emit("front");
  }
  /**
   * 是否在loading状态
   *
   * @return {boolean}
   */
  isLoading() {
    return this.webview.isLoading();
  }
  /**
   * 主页面是否在loading状态
   *
   * @return {boolean}
   */
  isLoadingMainFrame() {
    return this.webview.isLoadingMainFrame();
  }
  /**
   * 激活当前页面
   *
   * @return {Promise<this>}
   */
  bringToFront() {
    var _this = this;

    return _asyncToGenerator(function* () {
      if (!_this.isFront) {
        _this._browser._bringPageToFront(_this.id);
      }
      return _this;
    })();
  }
  /**
   * 获取当前page所属的browser
   *
   * @return {Browser}
   */
  browser() {
    return this._browser;
  }
  /**
   * 关闭当前page
   *
   * @return {Browser}
   */
  close() {
    this.container.removeChild(this.webview);
    this._browser._removePage(this.id);

    /**
     * 当前page关闭时触发
     * @event Page#close
     */
    this.emit("close");
  }
  /**
   * 获取指定多个url下的cookie数据
   * @param {string[]} urls url集合
   *
   * @return {Cookie[]} Cookie信息集合
   */
  cookies(urls) {
    return Promise.all(urls.map(url => this.session.cookies.get({ url }))).then(cookiesArray => [].concat(...cookiesArray));
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
    return Promise.all(cookies.map(cookie => this.session.cookies.remove(cookie.url, cookie, name)));
  }
  /**
   * 获取当前page下的所有frame集合，包含mainFrame和iframe
   *
   * @return {Frame[]}
   */
  frames() {
    // 递归挂载父的frame信息
    const mountParent = info => {
      if (info.isMainFrame) {
        info.parent = null;
      } else {
        let parent = this._frames.find(item => item.UUID === info.parentIdfa);
        info.parent = parent && mountParent(parent);
      }

      return info;
    };

    return this._frames.map(info => new _Frame2.default(this, this.webview, mountParent(info)));
  }
  /**
   * 当前page是否可后退
   *
   * @return {boolean}
   */
  canGoBack() {
    return this.webview.canGoBack();
  }
  /**
   * 当前page是否可前进
   *
   * @return {boolean}
   */
  canGoForward() {
    return this.webview.canGoForward();
  }
  /**
   * page后退
   *
   * @return {undefined}
   */
  goBack() {
    return this.webview.goBack();
  }
  /**
   * page前进
   *
   * @return {undefined}
   */
  goForward() {
    return this.webview.goForward();
  }
  /**
   * 当前page是否关闭
   *
   * @return {boolean}
   */
  isClosed() {
    return this.closed;
  }
  /**
   * 获取mainFrame
   *
   * @return {Frame}
   */
  mainFrame() {
    return this._mainFrame;
  }
  /**
   * 搜索页面内是否存在指定文本
   * @param {string} text 要搜索的文本
   *
   * @return {Promise<boolean>}
   */
  find(text) {
    return new Promise(resolve => {
      const timeout = setTimeout(() => {
        onFound({});
      }, 500);

      const onFound = ({ result }) => {
        clearTimeout(timeout);
        this.webview.removeEventListener("found-in-page", onFound);
        this.webview.stopFindInPage("clearSelection");
        resolve(result && result.matches > 0);
      };
      this.webview.addEventListener("found-in-page", onFound);
      this.webview.findInPage(text, {
        matchCase: true
      });
    });
  }
  /**
   * 刷新页面
   * 暂不支持options
   */
  reload() {
    return this.webview.reload();
  }
  /**
   * 指定区域的截图
   * 调用webview.capturePage
   * @param {Object} rect x, y, width, height属性
   *
   * @return {Promise<NativeImage>}
   */
  screenshot(rect) {
    return this.webview.capturePage(rect);
  }
  /**
   * 设置cookie
   * @param  {...Cookie} cookies
   *
   * @return {Promise}
   */
  setCookie(...cookies) {
    return Promise.all(cookies.map(cookie => this.session.cookies.set(cookie)));
  }
  /**
   * todo
   * 等待页面发起指定请求
   *
   * @return {Promise<never>}
   */
  waitForRequest() /* urlOrPredicate, options */{
    return Promise.reject("todo");
  }
  /**
   * todo
   * 等待页面的指定请求返回
   *
   * @return {Promise<never>}
   */
  waitForResponse() /* urlOrPredicate, options */{
    return Promise.reject("todo");
  }
  /**
   * todo
   *
   * @return {Promise<never>}
   */
  evaluateHandle() {
    return Promise.reject("todo");
  }
  /**
   * todo
   *
   * @return {Promise<never>}
   */
  queryObjects() {
    return Promise.reject("todo");
  }
  _setTarget(target) {
    this._target = target;
  }
  /**
   * 返回当前页面的target
   */
  target() {
    return this._target;
  }
}

exports.default = (0, _util.proxyBindDecorator)([
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
 * [page.mainFrame().waitForSelector的简写]{@link Frame#waitForSelector}
 * @method Page#waitForSelector
 */
"waitForSelector",
/**
 * [page.mainFrame().waitForXPath的简写]{@link Frame#waitForXPath}
 * @method Page#waitForXPath
 */
"waitForXPath",
/**
 * [page.mainFrame().waitForSrcScript的简写]{@link Frame#waitForSrcScript}
 * @method Page#waitForSrcScript
 */
"waitForSrcScript",
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
"localStorageRemove"], function () {
  return this._mainFrame;
})(Page);