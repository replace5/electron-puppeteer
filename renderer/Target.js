/**
 * @file Target类
 */

/**
 * @class Target
 *
 */
export default class Target {
  /**
   * @constructor Target
   *
   * @param {*} page target对应page
   * @param {*} opener 当前target的opener
   */
  constructor(page, opener) {
    this._page = page
    this._opener = opener
    page._setTarget(this)
  }
  /**
   * 当前target所属browser
   * @return {Browser}
   */
  browser() {
    return this._page.browser()
  }
  /**
   * 当前target的opener
   * @return {Target}
   */
  opener() {
    return this._opener
  }
  /**
   * @async
   * 获取当前target的page
   * @return {Page}
   */
  async page() {
    return this._page
  }
  /**
   * 获取当前target的类型
   * @return {string}
   */
  type() {
    return "page"
  }
  /**
   * 打开的url
   * @return {string}
   */
  url() {
    return this._page.url()
  }
}
