"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _Browser = require("./Browser.js");

var _Browser2 = _interopRequireDefault(_Browser);

var _KeyboardShortcuts = require("./KeyboardShortcuts.js");

var _KeyboardShortcuts2 = _interopRequireDefault(_KeyboardShortcuts);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * @class BrowserManager
 */
/**
 * @file BrowserManager类
 */
class BrowserManager {
  /**
   * @constructor BrowserManager
   *
   */
  constructor() {
    this._browsers = new Map();
    // 快捷键
    new _KeyboardShortcuts2.default(this);
  }
  /**
   * 打开浏览器
   * @param {*} options 见Browser的options配置
   */
  launch(options) {
    const browser = new _Browser2.default(this, options);
    return browser.init().then(() => (this._browsers.set(browser.id, browser), browser));
  }
  get size() {
    return this._browsers.size;
  }
  /**
   * 获取最早打开的browser实例
   */
  getEarliest() {
    let browsers = [];
    this._browsers.forEach(item => {
      browsers.push(item);
    });

    return browsers.sort((a, b) => a.startTime - b.startTime).shift();
  }
  /**
   * 通过browserId获取browser实例
   * @param {string} browserId browser.id
   */
  get(browserId) {
    return this._browsers.get(browserId);
  }
  /**
   * 获取当前最视窗最前端的browser实例，也就是激活的browser实例
   */
  frontBrowser() {
    let front = null;
    this._browsers.forEach(item => {
      if (item.isFront === true) {
        front = item;
      }
    });

    return front;
  }
  frontPage() {
    let browser = this.frontBrowser();
    return browser && browser.frontPage();
  }
  /**
   * 删除browser，不可直接调用
   * 如需要关闭browser，请调用browser.close()
   * @private
   * @param {string} browserId
   */
  _removeBrowser(browserId) {
    this._browsers.delete(browserId);
  }
  /**
   * 激活browser，不可直接调用
   * 如需要激活页面，请调用browser.bringToFront()
   * @private
   * @param {string} pageId
   */
  _bringBrowserToFront(browserId) {
    this._browsers.forEach(browser => {
      if (browserId === browser.id) {
        browser._doFront();
      } else {
        browser._doBack();
      }
    });
  }
}
exports.default = BrowserManager;