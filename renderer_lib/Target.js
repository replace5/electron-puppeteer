"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

/**
 * @file Target类
 */

/**
 * @class Target
 *
 */
class Target {
  /**
   * @constructor Target
   *
   * @param {*} page target对应page
   * @param {*} opener 当前target的opener
   */
  constructor(page, opener) {
    this._page = page;
    this._opener = opener;
    page._setTarget(this);
  }
  /**
   * 当前target所属browser
   * @return {Browser}
   */
  browser() {
    return this._page.browser();
  }
  /**
   * 当前target的opener
   * @return {Target}
   */
  opener() {
    return this._opener;
  }
  /**
   * @async
   * 获取当前target的page
   * @return {Page}
   */
  page() {
    var _this = this;

    return _asyncToGenerator(function* () {
      return _this._page;
    })();
  }
  /**
   * 获取当前target的类型
   * @return {string}
   */
  type() {
    return "page";
  }
  /**
   * 打开的url
   * @return {string}
   */
  url() {
    return this._page.url();
  }
}
exports.default = Target;