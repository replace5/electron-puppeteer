"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _EventEmitter = require("./EventEmitter.js");

var _EventEmitter2 = _interopRequireDefault(_EventEmitter);

var _USKeyboardLayout = require("./USKeyboardLayout.js");

var _USKeyboardLayout2 = _interopRequireDefault(_USKeyboardLayout);

var _util = require("./util.js");

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * @class ElementHandle frame的dom操作句柄
 * @extends EventEmitter
 *
 * @property {Frame} frame 所属frame实例
 * @property {string} selector 选择器
 * @property {string} baseSelector 基础选择器，先查找baseSelector，再在baseSelector的基础上查找当前节点
 *
 */
class ElementHandle extends _EventEmitter2.default {
  /**
   * @constructor ElementHandle
   *
   * @param {Frame} frame 所属frame实例
   * @param {string} selector 选择器
   * @param {string} baseSelector 基础选择器，先查找baseSelector，再在baseSelector的基础上查找当前节点
   *
   */
  constructor(frame, selector, baseSelector) {
    super();

    this.id = (0, _util.uniqueId)("ElementHandle_");
    this.ipc = frame.ipc;
    this.frame = frame;
    this.selector = selector;
    this.baseSelector = baseSelector;
  }
  _joinSelfSelector() {
    var baseSelector = this.baseSelector.slice(0);
    baseSelector.push(this.selector);
    return baseSelector;
  }
  _joinSelector(selector, baseSelector) {
    baseSelector = baseSelector.slice(0);
    baseSelector.push(selector);
    return baseSelector;
  }
  /**
   * 基于当前节点，查询新的单个节点, 对应elm.querySelector(selector)
   * @param {string} selector
   *
   * @return {ElementHandle}
   */
  $(selector) {
    return new ElementHandle(this.frame, selector, this._joinSelfSelector());
  }
  /**
   * 基于当前节点，查询新的节点集合, 对应elm.querySelectorAll(selector)
   * @param {string} selector
   *
   * @return {Promise<ElementHandle[]>}
   */
  $$(selector) {
    return this.ipc.send("elementHandle.$$", {
      selector: selector,
      baseSelector: this._joinSelfSelector()
    }).then(length => {
      return new Array(length).map((v, i) => {
        return new ElementHandle(this.contentFrame(), [selector, i], this._joinSelfSelector());
      });
    });
  }
  /**
   * 查找节点，并将查找的节点作为参数传为pageFunction
   * @param {string} selector
   * @param {Function} pageFunction
   *
   * @return {Promise<*>}
   */
  $eval(selector, pageFunction) {
    var args = [].slice.call(arguments, 1);

    return this.ipc.send("elementHandle.$eval", {
      selector: selector,
      baseSelector: this._joinSelfSelector(),
      pageFunction: pageFunction.toString(),
      args: args
    });
  }
  /**
   * 查找节点集合，并将查找的节点集合作为参数传为pageFunction
   * @param {string} selector
   * @param {Function} pageFunction
   *
   * @return {Promise<*>}
   */
  $$eval(selector, pageFunction) {
    var args = [].slice.call(arguments, 1);

    return this.ipc.send("elementHandle.$$eval", {
      selector: selector,
      baseSelector: this._joinSelfSelector(),
      pageFunction: pageFunction.toString(),
      args: args
    });
  }
  /**
   * todo
   */
  $x() /* expression */{
    return Promise.reject("todo");
  }
  /**
   * todo
   */
  asElement() {
    return Promise.reject("todo");
  }
  /**
   * getBoundingClientRect
   *
   * @return {Promise<Object>}
   */
  getBoundingClientRect() {
    return this.ipc.send("elementHandle.getBoundingClientRect", {
      selector: selector,
      baseSelector: this.baseSelector
    });
  }
  /**
   * todo
   */
  boxModel() {
    return Promise.reject("todo");
  }
  /**
   * 点击当前节点
   * @param {*} options 暂不支持
   *
   * @return {Promise<undefined>}
   */
  click(options) {
    return this.ipc.send("elementHandle.click", {
      selector: this._joinSelfSelector(),
      options
    });
  }
  /**
   * 当前节点所属frame
   *
   * @return {Frame}
   */
  contentFrame() {
    return this.frame;
  }
  /**
   * todo
   */
  dispose() {
    return Promise.reject("todo");
  }
  /**
   * todo
   */
  executionContext() {
    return Promise.reject("todo");
  }
  /**
   * 设置checked属性为true，并触发change事件
   *
   * @return {Promise<undefined>}
   */
  check() {
    return this.ipc.send("elementHandle.check", {
      selector: this._joinSelfSelector()
    });
  }
  /**
   * 设置checked属性为false，并触发change事件
   *
   * @return {Promise<undefined>}
   */
  uncheck() {
    return this.ipc.send("elementHandle.uncheck", {
      selector: this._joinSelfSelector()
    });
  }
  /**
   * todo
   */
  getProperties() {
    return Promise.reject("todo");
  }
  /**
   * todo
   */
  getProperty() /* propertyName */{
    return Promise.reject("todo");
  }
  /**
   * focus当前节点
   *
   * @return {Promise<undefined>}
   */
  focus() {
    // console.log('focus: ', this._joinSelfSelector());
    return this.ipc.send("elementHandle.focus", {
      selector: this._joinSelfSelector()
    });
  }
  /**
   * 取消聚焦当前节点
   *
   * @return {Promise<undefined>}
   */
  // @noitce puppeteer不支持blur
  blur() {
    return this.ipc.send("elementHandle.blur", {
      selector: this._joinSelfSelector()
    });
  }
  /**
   * 获取节点的属性集合
   *
   * @return {Promise<Map<string, Object>>}
   */
  getAttributes() {
    return this.ipc.send("elementHandle.getAttributes", {
      selector: this._joinSelfSelector()
    }).then(function (attributes) {
      var map = new Map();
      for (var attr of attributes) {
        if (attributes.hasOwnProperty(attr)) {
          map.set(attr, {
            // @notice: 先简单实现
            jsonValue: function (value) {
              return value;
            }(attributes[attr])
          });
        }
      }
      return map;
    });
  }
  /**
   * 获取节点的指定属性值
   *
   * @return {Promise<Object>} 通过jsonValue()获取属性值
   */
  getAttribute(attrName) {
    return this.ipc.send("elementHandle.getAttribute", {
      selector: this._joinSelfSelector(),
      attrName: attrName
    }).then(function (value) {
      // @notice: 先简单实现
      return {
        jsonValue: function () {
          return value;
        }
      };
    });
  }
  /**
   * hover当前节点
   *
   * @return {Promise<undefined>}
   */
  hover() {
    return this.ipc.send("elementHandle.hover", {
      selector: this._joinSelfSelector()
    });
  }
  /**
   * todo
   */
  isIntersectingViewport() {
    return Promise.reject("todo");
  }
  /**
   * todo
   */
  jsonValue() {
    return Promise.reject("todo");
  }
  /**
   * 键入文本
   * @param {string} text 输入的文本内容, 暂时只支持单字符输入，即英文字母等
   * @param {*} options 暂不支持
   */
  // todo: 暂不支持options
  // todo： 暂只支持文字输入、Backspace、Enter
  press(text, options) {
    var key = _USKeyboardLayout2.default[text];
    if (!key) {
      return Promise.reject("key not define");
    }

    return this.ipc.send("elementHandle.press", {
      selector: this._joinSelfSelector(),
      keyCode: key.keyCode,
      text: text,
      options: options
    });
  }
  /**
   * todo
   */
  screenshot() /* options */{
    return Promise.reject("todo");
  }
  /**
   * todo
   */
  tap() {
    return Promise.reject("todo");
  }
  /**
   * todo
   */
  toString() {
    return Promise.reject("todo");
  }
  /**
   * todo
   */
  type() /* text, options */{
    return Promise.reject("todo");
  }
  /**
   * todo
   */
  uploadFile() /* ...filePaths */{
    return Promise.reject("todo");
  }
}
exports.default = ElementHandle; /**
                                  * @file ElementHandle类
                                  */