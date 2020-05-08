/**
 * @file Browser类
 */

const {remote} = require('electron');
const {Menu, MenuItem} = remote;
const Mousetrap = require('mousetrap');

import EventEmitter from "./EventEmitter.js"
import { uniqueId, importStyle } from "./util.js"
import Page from "./Page.js"
import ChromeTabs from "./libs/chrome-tabs/chrome-tabs.js"
import ChromeTabsCSS from "./libs/chrome-tabs/chrome-tabs.css.js"
import {loadingGif, faviconPng} from "./images.js"
import BrowserManager from "./BrowserManager.js";
importStyle(ChromeTabsCSS)

/**
 * @class Browser
 * @extends EventEmitter
 * 
 * @property {string} id browser实例的唯一id
 * @property {boolean} isFront 是否为激活状态
 * @property {BrowserManager} browserManager
 * @property {Object} options 传入的配置信息
 */
class Browser extends EventEmitter {
	/**
	 * Browser构造函数
   * @constructor Browser
	 * 
	 * @param {BrowserManager} browserManager
	 * @param {Object} options 传入配置
	 * @param {Element} options.container DOM容器 
	 * @param {boolean} [options.devtools] 是否打开控制台 
	 * @param {string} [options.partition] session标识，相同的partition共享登录状态
	 * @param {string} options.preload preload, 理论上必须为当前包的preload/webivew.preload.js, 否则无法通信
	 * @param {string} [options.startUrl] 新建tab的初始页面, 不传则为abount:blank
	 * @param {string} [options.startUrlReferrer] 打开的startUrl的referrer
	 * @param {string} [options.webpreferences] 网页功能的设置
	 */
	constructor(browserManager, options) {
		super()

		this.id = uniqueId('browser_')
		this._pages = []
		this.browserManager = browserManager
		this.options = options
	}
	/**
	 * Browser的初始化
	 * @async
	 */
	async init() {
		this.build()
		await this.newPage()
	}
	/**
	 * 获取browser相对于视窗的信息
	 */
	getBoundingClientRect() {
		return this.doms.pagesContainer.getBoundingClientRect()
	}
	/**
	 * Browser的构建
	 */
	build() {
		const template = `
			<div class="electron-puppeteer-browser">
				<div class="chrome-tabs">
					<div class="chrome-tabs-content"></div>
					<div class="chrome-tabs-content-add">
						<svg viewBox="64 64 896 896" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false" class=""><path d="M482 152h60q8 0 8 8v704q0 8-8 8h-60q-8 0-8-8V160q0-8 8-8z"></path><path d="M176 474h672q8 0 8 8v60q0 8-8 8H176q-8 0-8-8v-60q0-8 8-8z"></path></svg>
					</div>
					<div class="chrome-tabs-bottom-bar"></div>
				</div>
				<div class="electron-puppeteer-pages">
				</div>
			</div>
		`

		const div = document.createElement('div')
    div.innerHTML = template
		this.element = div.firstElementChild
		this.options.container.appendChild(this.element)
		
		this.doms = {
			tabsElm: this.element.querySelector('.chrome-tabs'),
			addBtn: this.element.querySelector('.chrome-tabs-content-add'),
			pagesContainer: this.element.querySelector('.electron-puppeteer-pages')
		}

		this._initChromeTabs()
		this._bindShortcuts()
	}
	/**
	 * 初始化顶部tab
	 * @private
	 */
	_initChromeTabs() {
		let chromeTabs = this._chromeTabs = new ChromeTabs()
		chromeTabs.init(this.doms.tabsElm)
		this.doms.tabsElm.addEventListener('activeTabChange', (evt) => {
			if (!evt.detail.trigger) {
				var pageId = evt.detail.tabEl.getAttribute('data-tab-id');
				var page = this.getPageById(pageId);
				page.bringToFront();
			}
		})
		this.doms.tabsElm.addEventListener('tabRemove', (evt) => {
			if (!evt.detail.trigger) {
				var pageId = evt.detail.tabEl.getAttribute('data-tab-id');
				var page = this.getPageById(pageId)
				page.$tabEl = null
				page.close()
			}
		})

		this.doms.addBtn.addEventListener('click', () => {
			this.newPage()
		})
	}
	/**
	 * 绑定快捷键
	 * @private
	 */
	_bindShortcuts() {
		this.shortcuts = [
			{
				action: "closePage",
				prevent : true,
				keys: ["command+w", "ctrl+w"],
				callback: () => {
					let frontPage = this.frontPage()
					if (this.isFront && frontPage) {
						frontPage.close()
					}
				}
			},
			{
				action: "newPage",
				prevent : true,
				keys: ["command+t", "ctrl+t"],
				callback: () => {
					if (this.isFront) {
						this.newPage()
					}
				}
			},
			{
				action: "reload",
				prevent : true,
				keys: ["f5"],
				callback: () => {
					let frontPage = this.frontPage()
					if (this.isFront && frontPage && frontPage.isReady) {
						frontPage.reload()
					}
				}
			},
			{
				action: "toggleDevtools",
				prevent : true,
				keys: ["command+option+i", "ctrl+shift+i", "f12"],
				callback: () => {
					let frontPage = this.frontPage()
					if (this.isFront && frontPage && frontPage.isReady) {
						if (frontPage.webview.isDevToolsOpened()) {
							frontPage.webview.closeDevTools()
						} else {
							frontPage.webview.openDevTools()
						}
					}
				}
			},
		]

		this.shortcuts.forEach(item => {
			Mousetrap.bind(item.keys, () => {
				if (item.callback) {
					item.callback.call(this)
				}
				if (item.prevent) {
					return false
				}
			})
		})

		Mousetrap.bind('?', (evt) => {
			console.log('show shortcuts!', evt)
		})
	}
	_doBack() {
		this.isFront = false
		this.element.style.display = 'none'
	}
	_doFront() {
		this.isFront = true
		this.element.style.display = ''
		// 每次切换browser的时候强制重新布局，防止当前browser不可见时导致的tab样式错乱
		this._chromeTabs.layoutTabs()
	}
	/**
	 * 将browser提到视窗最前端，相当于多个browser，切换到当前
	 */
	bringToFront() {
		this.browserManager._bringBrowserToFront(this.id)
		this.emit('bringToFront', this.id)
	}
	/**
	 * 关闭browser
	 */
	close() {
		this._pages.forEach(page => {
			page.close()
		})

		this.options.container.removeChild(this.element)
		this.browserManager._removeBrowser(this.id)
		this.emit('close', this.id)
	}
	/**
	 * 获取browser下的所有page实例集合
	 * @async
	 * 
	 * @return {Page[]}
	 */
	async pages() {
		return this._pages.slice(0)
	}
	/**
	 * 通过pageid获取指定page实例
	 * 
	 * @return {Page}
	 */
	getPageById(pageId) {
		return this._pages.find(item => item.id === pageId)
	}
	/**
	 * 获取当前激活的page
	 * 
	 * @return {Page}
	 */
	frontPage() {
		return this._pages.find(item => item.isFront === true)
	}
	/**
	 * 新建页面
	 * @async
	 * @param {string} [url] 页面跳转地址，不传则跳转到browser的startUrl
	 * @param {string} [referer] referrer，不传则为browser的startUrlReferrer
	 * 
	 * @return {Promise<Page>} 返回构建的page实例
	 */
	async newPage(url, referer) {
		var page = new Page(this, {
			container: this.doms.pagesContainer,
			partition: this.options.partition,
			devtools: this.options.devtools,
			preload: this.options.preload,
			startUrl: url || this.options.startUrl,
			startUrlReferrer: referer || this.options.startUrlReferrer,
		})
		page._injectShortcuts(this.shortcuts.slice(0))
		await page.init()
		this._pages.push(page)
		this._handlePageTab(page)
		await page.bringToFront()

		this.emit('newPage', page)
		return page
	}
	/**
	 * page对应tab的右键菜单，图标及标题的更新
	 * @private
	 * @param {Page} page 
	 */
	_handlePageTab(page) {
		let elm = page.$tabEl = this._chromeTabs.addTab({
			id: page.id,
			title: "加载中……",
			favicon: faviconPng
		}, {
			background: true
		})

		elm.addEventListener('contextmenu', (evt) => {
			this._showTabMenu(page)
		})

		let iconSet = false
		page.on('loading-start', () => {
			iconSet = false
			this._chromeTabs.updateTab(page.$tabEl, {
				favicon: loadingGif
			})
		})
		page.on('favicon-updated', (evt) => {
			iconSet = true
			this._chromeTabs.updateTab(page.$tabEl, {
				favicon: evt.favicon
			})
			var img = new Image();
			img.src = evt.favicon;
			img.onerror = () => {
				this._chromeTabs.updateTab(page.$tabEl, {
					favicon: faviconPng
				});
				img.onerror = null;
				img = null;
			}
		})
		page.on('title-updated', (evt) => {
			this._chromeTabs.updateTab(page.$tabEl, {
				title: evt.title
			})
		})
		page.on('loading-end', () => {
			if (!iconSet) {
				this._chromeTabs.updateTab(page.$tabEl, {
					favicon: faviconPng
				})
			}
		})
		page.on('new-window', async (evt) => {
			let url = page.url()
			let pageNew = await this.newPage()
			await pageNew.goto(evt.url, {
				referer: url
			})
		})
	}
	/**
	 * tab的右键菜单
	 * @private
	 * @param {Page} page 
	 */
	_showTabMenu(page) {
		//右键菜单
		const menu = new Menu();
		menu.append(new MenuItem({
			label: '刷新                  F5',
			click: () => {
				page.reload()
			}
		}));
		menu.append(new MenuItem({
			label: '复制',
			click:  () => {
				this.newPage(page.url(), page.url())
			}
		}));
		menu.append(new MenuItem({
			type: 'separator',
		}));
		menu.append(new MenuItem({
			label: '前进',
			enabled: page.canGoForward(),
			click: () => {
				page.goForward();
			}
		}));
		menu.append(new MenuItem({
			label: '后退',
			enabled: page.canGoBack(),
			click: () => {
				page.goBack();
			}
		}));
		menu.append(new MenuItem({
			type: 'separator',
		}));
		menu.append(new MenuItem({
				label: '关闭                  Ctrl+W',
				click: () => {
					page.close()
				}
		}));
		menu.append(new MenuItem({
			label: '关闭其它',
			click: () => {
				this._pages.filter(item => item.id !== page.id).forEach(item => item.close())
			}
		}));
		menu.popup({window: remote.getCurrentWindow()})
	}
	/**
	 * 删除页面，不可直接调用
	 * 如需要关闭页面，请调用page.close()
	 * @private
	 * @param {string} pageId 
	 */
	_removePage(pageId) {
		var index = this._pages.findIndex(page => page.id === pageId)
		var page = this._pages[index]
		this._pages.splice(index, 1)
		if (page.$tabEl) {
			this._chromeTabs.removeTab(page.$tabEl, true)
		}

		if (!page.isFront) {
			return
		}

		var nextPage = this._pages[index] || this._pages[index - 1]
		if (nextPage) {
			nextPage.bringToFront()
		}
	}
	/**
	 * 激活页面，不可直接调用
	 * 如需要激活页面，请调用page.bringToFront()
	 * @private
	 * @param {string} pageId 
	 */
	_bringPageToFront(pageId) {
		this._pages.forEach(page => {
			if (pageId === page.id) {
				this._chromeTabs.setCurrentTab(page.$tabEl, true)
				page._doFront()
			} else {
				page._doBack()
			}
		})
	}
}