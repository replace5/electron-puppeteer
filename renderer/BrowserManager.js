/**
 * @file BrowserManager类
 */
import Browser from './Browser.js'

/**
 * @class BrowserManager
 */
export default class BrowserManager {
	/**
   * @constructor BrowserManager
	 * 
	 */
	constructor() {
		this._browsers = new Map()
	}
	/**
	 * 打开浏览器
	 * @param {*} options 见Browser的options配置
	 */
	launch(options) {
		const browser = new Browser(this, options)
		return browser.init().then(() => (this._browsers.set(browser.id, browser), browser))
	}
	/**
	 * 通过browserId获取browser实例
	 * @param {string} browserId browser.id
	 */
	get(browserId) {
		return this._browsers.get(browserId)
	}
	/**
	 * 获取当前最视窗最前端的browser实例，也就是激活的browser实例
	 */
	frontBrowser() {
		return this._browsers.find(item => item.isFront === true)
	}
	/**
	 * 删除browser，不可直接调用
	 * 如需要关闭browser，请调用browser.close()
	 * @private
	 * @param {string} browserId 
	 */
	_removeBrowser(browserId) {
		this._browsers.delete(browserId)
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
				browser._doFront()
			} else {
				browser._doBack();
			}
		})
	}
}