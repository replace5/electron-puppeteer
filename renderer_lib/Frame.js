"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _EventEmitter = require("./EventEmitter.js");

var _EventEmitter2 = _interopRequireDefault(_EventEmitter);

var _ElementHandle = require("./ElementHandle.js");

var _ElementHandle2 = _interopRequireDefault(_ElementHandle);

var _ipc = require("./ipc.js");

var _util = require("./util.js");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

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
class Frame extends _EventEmitter2.default {
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
    super();

    this._frameInfo = frameInfo;

    this._page = page;
    this.webview = webviewElement;
    // webview的webContentsId
    this._webContentsId = frameInfo.routingId;
    this.isMainFrame = frameInfo.isMainFrame;
    this.ipc = new _ipc.BoundIpc(this.webview, frameInfo.UUID);
    this.document = new _ElementHandle2.default(this, "document", []);

    this._childFrames = [];
    this._listenChildFramesRegister();
    this._listenChildFramesUnregister();
  }
  // 监听当前frame下子iframe的注册事件
  _listenChildFramesRegister() {
    this.ipc.on("childFrame.register", frameInfo => {
      let originInfo = this._childFrames.find(item => item.UUID === frameInfo.UUID);
      if (originInfo) {
        Object.assign(originInfo, frameInfo);
      } else {
        this._childFrames.push(frameInfo);
      }
    });
  }
  // 监听当前frame下子iframe的注销事件
  _listenChildFramesUnregister() {
    this.ipc.on("childFrame.unregister", frameInfo => {
      this._childFrames = this._childFrames.filter(item => item.UUID !== frameInfo.UUID);
    });
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
    return this.ipc.send("frame.addScriptTag", options);
  }
  /**
   * 注入一个link(url)或style(content)标签到页面
   * @param {Object} options
   * @property {string} [options.url] 要添加的css link的src
   * @property {string} [options.content] 要注入页面的style代码
   *
   * @return {Promise<ElementHandle>} 返回注入样式的dom句柄实例
   */
  addStyleTag(options) {
    return this.ipc.send("frame.addStyleTag", options);
  }
  /**
   * 获取当前frame
   */
  childFrames() {
    return this._childFrames.map(info => new Frame(this._page, this.webview, _extends({}, info, {
      parent: this._frameInfo
    })));
  }
  /**
   * todo
   * 获取frame的内容
   *
   * @return {string}
   */
  content() {
    return this.ipc.send("frame.content");
  }
  /**
   * 在frame运行指定函数
   * @param {Function} pageFunction
   * @param {string[]|number[]} args 传给pageFunction的参数
   * @param {number} [timeout]  等待超时时间
   *
   * @return {Promise<*>} 返回运行结果，若pageFunction返回Promise，会等待Promise的resolve结果
   */
  evaluate(pageFunction, args, timeout) {
    if (!Array.isArray(args)) {
      timeout = args;
      args = [];
    }

    args = args.map(function (arg) {
      return JSON.stringify(arg);
    });

    if (typeof pageFunction == "string") {
      pageFunction = "function() {return " + pageFunction + "}";
    }

    return this.ipc.send("frame.evaluate", { pageFunction: pageFunction.toString(), args: args }, timeout);
  }
  /**
   * 控制当前frame跳转到指定url
   * 会在超时时间内追踪重定向，直到跳转到最终页面
   * @param {string} url
   * @param {Object} [options]
   * @property {string} [options.waitUntil] 认定跳转成功的事件类型 load|domcontentloaded，默认为domcontentloaded
   * @property {number} [options.timeout] 超时时间，单位为ms，默认为5000ms
   *
   * @return {Promise<undefined>}
   */
  goto(url, options) {
    var _this = this;

    return _asyncToGenerator(function* () {
      let timeout = options && options.timeout || 5e3;
      var waitUntil = options && options.waitUntil || "domcontentloaded";

      // 递归获取最终的跳转地址
      // timeout计时结束后就停止监听跳转
      var redirectURL = url;
      const _getRedirectUrl = function () {
        _this.page().webRequest.onBeforeRedirect({
          urls: ["http://*/*", "https://*/*"]
        }, function (details) {
          if (details.url === redirectURL) {
            redirectURL = details.redirectURL;
            // console.log('onBeforeRedirect: ', redirectURL)
          }
        });
      };
      _getRedirectUrl();

      yield _this.ipc.send("frame.goto", {
        url: url
      });

      return new _util.TimeoutPromise(function (resolve) {
        _this.ipc.on("frame.goto." + waitUntil, function (payload) {
          if (payload.url === redirectURL) {
            resolve(payload);
          }
        });
      }, timeout).catch(function (err) {
        if (err === "promise.timeout") {
          return Promise.reject("goto.timeout");
        }
        return Promise.reject(err);
      });
    })();
  }
  /**
   * todo
   */
  isDetached() {
    return Promise.reject("todo");
  }
  /**
   * frame的名称
   *
   * @return {string}
   */
  name() {
    return this._frameInfo.name;
  }
  /**
   * frame所属的page实例
   *
   * @return {Page}
   */
  page() {
    return this._page;
  }
  /**
   * frame的parentFrame
   * 如果当前frame为mainFrame，返回null
   *
   * @return {Frame}
   */
  parentFrame() {
    if (this._frameInfo.parent) {
      return new Frame(this._page, this.webview, this._frameInfo.parent);
    }
    return null;
  }
  /**
   * todo
   */
  select() {
    return Promise.reject("todo");
  }
  /**
   * todo
   * 设置页面内容
   * @param {string} html
   *
   * @return {Promise<undefined>}
   */
  setContent(html) {
    return this.ipc.send("frame.setContent", html);
  }
  /**
   * frame的标题
   *
   * @return {string}
   */
  title() {
    if (this.isMainFrame) {
      return this.webview.getTitle();
    }

    return this.ipc.send("frame.title");
  }
  /**
   * todo
   * 未实现，请使用press方法
   * 输入指定内容
   * @param {string} selector 要输入的dom的选择，input或textarea
   * @param {string} text 输入的文本
   * @param {Object} [options]
   * @property {number} [options.delay] // 延迟输入, 操作更像用户
   */
  type(selector, text, options) {
    return this.ipc.send("frame.type", { selector, text, options });
  }
  /**
   * 获取url，如果是mainFrame为当前url，如果是iframe，则是src属性
   *
   * @return {string}
   */
  url() {
    if (this.isMainFrame) {
      return this.webview.getURL();
    }

    return this._frameInfo.url;
  }
  /**
   * waitForSelector|waitForFunction|setTimeout的结合体
   * @param {string|number|Function} selectorOrFunctionOrTimeout
   * @param {Object} options
   * @param  {...any} args
   */
  waitFor(selectorOrFunctionOrTimeout, options, ...args) {
    if (typeof selectorOrFunctionOrTimeout === "string") {
      return this.waitForSelector(selectorOrFunctionOrTimeout, options);
    } else if (typeof selectorOrFunctionOrTimeout === "number") {
      return new Promise(resolve => {
        setTimeout(resolve, selectorOrFunctionOrTimeout);
      });
    } else {
      return this.waitForFunction(selectorOrFunctionOrTimeout, options, ...args);
    }
  }
  /**
   * 在指定时间内轮询执行方法，直到方法返回true
   * @param {Function} pageFunction
   * @param {Object} [options]
   * @property {number} [options.timeout] 等待时间
   * @param  {...any} args
   *
   * @return {Promise<boolean>} 成功返回resove(true)，超时返回reject
   */
  waitForFunction(pageFunction, options, ...args) {
    if (typeof pageFunction == "string") {
      pageFunction = "function() {return " + pageFunction + "}";
    }

    return this.ipc.send("frame.waitForFunction", {
      pageFunction: pageFunction.toString(),
      args: args,
      options
    });
  }
  /**
   * 等待跳转完成
   * @param {Object} [options]
   * @property {string} [options.waitUntil] 认定跳转成功的事件类型 load|domcontentloaded，默认为domcontentloaded
   * @property {number} [options.timeout] 超时时间，单位为ms，默认为5000ms
   *
   * @return {Promise<Object>} 返回跳转后frame的信息
   */
  waitForNavigation(options) {
    return new _util.TimeoutPromise(resolve => {
      var waitUntil = options && options.waitUntil || "domcontentloaded";
      this.ipc.once("frame.waitForNavigation." + waitUntil, function (param) {
        resolve(param);
      });
    }, options && options.timeout || 5e3).catch(err => {
      if (err === "promise.timeout") {
        return Promise.reject("waitForNavigation.timeout");
      }
      return Promise.reject(err);
    });
  }
  /**
   * 在指定时间内轮询查询dom节点，直到查找到节点
   * @param {string} selector dom节点选择器
   * @param {Object} [options]
   * @property {boolean} [options.visible] 节点是否可见，如果visible为true时必须查到到dom节点且可见才会返回true
   * @property {number} [options.timeout] 超时时间，单位为ms，默认为10000ms
   *
   * @return {Promise<undefined>} 成功则resolve，失败返回reject
   */
  waitForSelector(selector, options) {
    return this.ipc.send("frame.waitForSelector", {
      selector: selector,
      options: options
    }, options && options.timeout);
  }
  /**
   * todo
   */
  waitForXPath() /* xpath, options */{
    return Promise.reject("todo");
  }
  /**
   * 点击frame内的指定节点
   * @param {string} selector 选择器
   * @param {Object} options 暂不支持
   *
   * @return {Promise<boolean>}
   */
  click(selector, options) {
    return this.document.$(selector).click(options);
  }
  /**
   * 聚焦frame内的指定节点
   * @param {string} selector 选择器
   * @param {Object} options 暂不支持
   *
   * @return {Promise<boolean>}
   */
  focus(selector, options) {
    return this.document.$(selector).focus(options);
  }
  /**
   * 取消聚焦frame内的指定节点
   * @param {string} selector 选择器
   * @param {Object} options 暂不支持
   *
   * @return {Promise<boolean>}
   */
  blur(selector, options) {
    return this.document.$(selector).blur(options);
  }
  /**
   * 鼠标移入frame内的指定节点，对应mouseover事件
   * @param {string} selector 选择器
   * @param {Object} options 暂不支持
   *
   * @return {Promise<boolean>}
   */
  hover(selector, options) {
    return this.document.$(selector).hover(options);
  }
  /**
   * todo
   */
  tap(selector, options) {
    return this.document.$(selector).tap(options);
  }
  /**
   * 获取localStorage的所有key集合
   */
  localStorageKeys() {
    return this.ipc.send("frame.localStorageKeys");
  }
  /**
   * localStorage.getItem
   * @param {string} key
   *
   * @return {Promise<string>}
   */
  localStorageGet(key) {
    return this.ipc.send("frame.localStorageGet", {
      key: key
    });
  }
  /**
   * localStorage.setItem
   * @param {string} key
   * @param {string} value
   *
   * @return {Promise<undefined>}
   */
  localStorageSet(key, value) {
    return this.ipc.send("frame.localStorageSet", {
      key: key,
      value: value
    });
  }
  /**
   * localStorage.removeItem
   * @param {string} key
   *
   * @return {Promise<undefined>}
   */
  localStorageRemove(key) {
    return this.ipc.send("frame.localStorageRemove", {
      key: key
    });
  }
}

exports.default = (0, _util.proxyBindDecorator)([
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
"$x"], function () {
  return this.document;
})(Frame);