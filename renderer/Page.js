/**
 * @file Page Page类
 */

import EventEmitter from "./EventEmitter.js"
import Frame from './Frame.js'
import { uniqueId, proxyBindDecorator, importStyle } from "./util.js"
import {BoundIpc} from "./ipc.js"
import styleCss from "./style.css.js"
importStyle(styleCss)

const { remote } = require('electron')
const contextMenu = require('electron-context-menu');

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
 * 以下方法是绑定在mainFrame下运行的，由Frame类实现
 * @property {Frame.$} $ 
 * @property {Frame.$$} $$
 * @property {Frame.$eval} $eval
 * @property {Frame.$$eval} $$eval
 * @property {Frame.$x} $x
 * @property {Frame.addScriptTag} addScriptTag
 * @property {Frame.addStyleTag} addStyleTag
 * @property {Frame.click} click
 * @property {Frame.content} content
 * @property {Frame.evaluate} evaluate
 * @property {Frame.focus} focus
 * @property {Frame.hover} hover
 * @property {Frame.goto} goto
 * @property {Frame.select} select
 * @property {Frame.setContent} setContent
 * @property {Frame.tap} tap
 * @property {Frame.title} title
 * @property {Frame.type} type
 * @property {Frame.url} url
 * @property {Frame.waitFor} waitFor
 * @property {Frame.waitForFunction} waitForFunction
 * @property {Frame.waitForNavigation} waitForNavigation
 * @property {Frame.waitForNavigateTo} waitForNavigateTo
 * @property {Frame.waitForSelector} waitForSelector
 * @property {Frame.waitForXPath} waitForXPath
 * @property {Frame.waitForSrcScript} waitForSrcScript
 * @property {Frame.localStorageKeys} localStorageKeys
 * @property {Frame.localStorageGet} localStorageGet
 * @property {Frame.localStorageSet} localStorageSet
 * @property {Frame.localStorageRemove} localStorageRemove
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
	 * @param {string} [options.startUrl] 初始页面
	 * @param {string} [options.startUrlReferrer] startUrl的referrer
	 * @param {string} options.preload preload的脚本路径, 理论上必须为当前包的preload/webivew.preload.js
	 * @param {string} [options.webpreferences] 网页功能的设置
	 * 
	 */
	constructor(browser, options) {
		super()

		this._browser = browser
		this.id = uniqueId('page_')
		this.options = options
		this.closed = false
		this.isFront = false
		this.isReady = false
		this.container = options.container
		this._frames = []
	}
	/**
	 * 初始化函数
	 * 
	 * @return {Promise<undefined>}
	 */
	async init() {
		await this.build()
		this._mainFrame = new Frame(this, this.webview, {
			UUID: '~',
			routingId: this._webContentsId,
			isMainFrame: true
		})
	}
	/**
	 * 构建函数
	 * 
	 * @return {Promise<undefined>}
	 */
	build() {
		const {startUrl, startUrlReferrer, preload, webpreferences} = this.options
		const partition = this.options.partition

		const webview = document.createElement('webview')
		webview.partition = partition
		if (startUrlReferrer) {
			webview.httpreferrer = startUrlReferrer
		}
		webview.src = startUrl || 'abount:blank'
		webview.nodeintegrationinsubframes = true
		webview.nodeintegration = false
		webview.preload = preload
		webview.webpreferences = webpreferences
		this.container.appendChild(webview)

		this.webview = webview
		this.session = remote.session.fromPartition(partition)
		this.webRequest = this.session.webRequest

		this.ipc = new BoundIpc(webview, '*')
		this._listenFramesRegister()
		this._listenFramesUnregister()
		this._bindWebviewEvent()
		this._bindIPCEvent()

		return new Promise((resolve, reject) => {
			const onDomReady = () => {
				if (this.options.devtools) {
					webview.openDevTools()
				}
				this._bindContextMenu()
				this.isReady = true
				webview.removeEventListener('dom-ready', onDomReady)
				resolve()
			}
			webview.addEventListener('dom-ready', onDomReady)
			setTimeout(() => reject("page.build timeout"), 1e4)
		})
	}
	// 监听页面的iframe的注册事件
	_listenFramesRegister() {
		this.ipc.on('frame.register', (frameInfo) => {
			if (!frameInfo.isMainFrame) {
				let originInfo = this._frames.find(item => item.UUID === frameInfo.UUID)
				if (originInfo) {
					Object.assign(originInfo, frameInfo)
				} else {
					this._frames.push(frameInfo)
				}
			} else {
				// mainFrame的_webContentsId
				this._webContentsId = frameInfo.routingId
				if (this._mainFrame) {
					this._mainFrame._webContentsId = frameInfo.routingId
				}
			}
			this.emit('frame.register', frameInfo)
		})

	}
	// 监听页面的iframe的注销事件
	_listenFramesUnregister() {
		this.ipc.on('frame.unregister', (frameInfo) => {
			if (!frameInfo.isMainFrame) {
				this._frames = this._frames.filter(item => item.UUID !== frameInfo.UUID)
			}
		})
	}
	// 转发webview的dom事件
	_proxyDOMEvent(originName, emitName, modifyEvent, isMainFrame) {
		this.webview.addEventListener(originName, (evt) => {
			if (!isMainFrame || evt.isMainFrame) {
				modifyEvent && modifyEvent(evt)
				this.emit(emitName, evt)
			}
		})
		return this;
	}
	// 转发ipc事件
	_prxoyIPCEvent(originName, emitName, modifyPayload) {
		this.ipc.on(originName, (payload) => {
			modifyPayload && modifyPayload(payload)
			this.emit(emitName, payload)
		})
		return this;
	}
	// 需要绑定的快捷键
	_injectShortcuts(shortcuts) {
		this.shortcuts = shortcuts
	}
	// 监听webview的dom事件
	_bindWebviewEvent() {
		this._proxyDOMEvent("did-start-loading", "load-start")
			._proxyDOMEvent("did-fail-load", "load-fail")
			._proxyDOMEvent("did-stop-loading", "load-end")
			._proxyDOMEvent("did-finish-load", "load-end")
			._proxyDOMEvent("did-frame-finish-load", "load-end", null, true)
			._proxyDOMEvent('page-title-updated', "title-updated")
			._proxyDOMEvent('favicon-updated', "favicon-updated", (evt) => {
				evt.favicon = evt.favicons.pop()
			})
			._proxyDOMEvent('new-window', "new-window", (evt) => {
				evt.url = this.webview.getURL()
			})

	}
	// 监听ipc事件
	_bindIPCEvent() {
		this._prxoyIPCEvent('page.title', 'title-updated')
			._prxoyIPCEvent('page.favicon', 'favicon-updated')

		// iframe和页面加载完成后会请求快捷键
		this.ipc.on('page.shortcuts.call', () => {
			return (this.shortcuts || []).map(item => ({...item, callback: null}))
		})
		// 监听快捷键绑定回复
		this.ipc.on("page.shortcuts.trigger", (payload) => {
			(this.shortcuts || []).map(item => {
				if (item.action && payload.action === item.action || item.keys.toString() === payload.keys.toString()) {
					item.callback.call(this)
				}
			})
		})
	}
	// 绑定右键菜单
	_bindContextMenu() {
		contextMenu({
			prepend: (defaultActions, params, browserWindow) => [{
				label: 'Open Link in new Tab',
				visible: params.linkURL.length !== 0 && params.mediaType === 'none',
				click: () => {
					this.browser().newPage(params.linkURL, this.url())
				}
			}],
			window: this.webview
		});
	}
	// 不可直接调用
	// 取消激活
	_doBack() {
		this.isFront = false
		this.webview.style.display = 'none'
	}
	// 不可直接调用
	// 激活
	_doFront() {
		this.isFront = true
		this.webview.style.display = 'flex'
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
	/**
	 * 关闭当前page
	 * 
	 * @return {Browser}
	 */
	close() {
		this.container.removeChild(this.webview)
		this._browser._removePage(this.id)
	}
	/**
	 * 获取指定多个url下的cookie数据
	 * @param {string[]} urls url集合
	 * 
	 * @return {Cookie[]} Cookie信息集合
	 */
	cookies(urls) {
		return Promise.all(urls.map(url => this.session.cookies.get({url})))
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
		return Promise.all(cookies.map(cookie => this.session.cookies.remove(cookie.url, cookie,name)))
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
				let parent = this._frames.find(item => item.UUID === info.parentIdfa)
				info.parent = parent && mountParent(parent)
			}

			return info
		}

		return this._frames.map(info => new Frame(this, this.webview, mountParent(info)))
	}
	/**
	 * 当前page是否可后退
	 * 
	 * @return {boolean}
	 */
	canGoBack() {
		return this.webview.canGoBack()
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
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				onFound({})
			}, 500);

			const onFound = ({result}) => {
				clearTimeout(timeout)
				this.webview.removeEventListener('found-in-page', onFound)
				this.webview.stopFindInPage('clearSelection')
				resolve(result && result.matches > 0)
			}
			this.webview.addEventListener('found-in-page', onFound)
			this.webview.findInPage(text, {
				matchCase: true
			})
		})
	}
	/**
	 * 刷新页面
	 * 暂不支持options
	 */
	reload() {
		return this.webview.reload()
	}
	/**
	 * 指定区域的截图
	 * 调用webview.capturePage
	 * @param {Object} rect x, y, width, height属性
	 * 
	 * @return {Promise<NativeImage>} 
	 */
	screenshot(rect) {
		return this.webview.capturePage(rect)
	}
	/**
	 * 设置cookie
	 * @param  {...Cookie} cookies 
	 * 
	 * @return {Promise}
	 */
	setCookie(...cookies) {
		return Promise.all(cookies.map(cookie => this.session.cookies.set(cookie)))
	}
	/**
	 * todo
	 * 等待页面发起指定请求
	 * 
	 * @return {Promise<never>}
	 */
	waitForRequest(urlOrPredicate, options) {
		return Promise.reject('todo')
	}
	/**
	 * todo
	 * 等待页面的指定请求返回
	 * 
	 * @return {Promise<never>}
	 */
	waitForResponse(urlOrPredicate, options) {
		return Promise.reject('todo')
	}
	/**
	 * todo
	 * 
	 * @return {Promise<never>}
	 */
	evaluateHandle() {
		return Promise.reject('todo')
	}
	/**
	 * todo
	 * 
	 * @return {Promise<never>}
	 */
	queryObjects() {
		return Promise.reject('todo')
	}
}

export default proxyBindDecorator([
	"$",
	"$$",
	"$eval",
	"$$eval",
	"$x",
	"addScriptTag",
	"addStyleTag",
	"click",
	"content",
	"evaluate",
	"focus",
	"hover",
	"goto",
	"select",
	"setContent",
	"tap",
	"title",
	"type",
	"url",
	"waitFor",
	"waitForFunction",
	"waitForNavigation",
	"waitForNavigateTo",
	"waitForSelector",
	"waitForXPath",
	"waitForSrcScript",
	"localStorageKeys",
	"localStorageGet",
	"localStorageSet",
	"localStorageRemove",
], function() {
	return this._mainFrame
})(Page)