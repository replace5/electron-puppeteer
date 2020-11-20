/**
 * @file Browser类
 */

const {remote, clipboard} = require("electron")
const {Menu, MenuItem} = remote
const Store = require("electron-store")
const store = new Store()

const currentWindow = remote.getCurrentWindow()

import EventEmitter from "./EventEmitter.js"
import {BROWSER_WINDOW_PAGE_CONNECT} from "./ipc.js"
import {
  uniqueId,
  importStyle,
  setDomAsOffsetParent,
  parseStrToDOM,
  isElementInViewport,
} from "./util.js"
import Page, {WindowPage} from "./Page.js"
import Target from "./Target.js"
import ChromeTabs from "./libs/chrome-tabs/chrome-tabs.js"
import ChromeTabsCSS from "./libs/chrome-tabs/chrome-tabs.css.js"
import {loadingGif, faviconPng} from "./images.js"
importStyle(ChromeTabsCSS, "electron-puppeteer-chrome-tabs")

/**
 * @class Browser
 * @extends EventEmitter
 *
 * @property {string} id browser实例的唯一id
 * @property {boolean} isReady 是否为就绪状态，即构建完成，可以获取page
 * @property {boolean} isFront 是否为激活状态
 * @property {BrowserManager} browserManager
 * @property {Object} options 传入的配置信息
 */
export default class Browser extends EventEmitter {
  /**
   * Browser构造函数
   * @constructor Browser
   *
   * @param {BrowserManager} browserManager
   * @param {Object} options 传入配置
   * @param {Element} options.container DOM容器
   * @param {boolean} options.tabs 是否显示tabs
   * @param {number} options.autoGcTime 闲置后的自动回收时间，单位为ms, 为0时为永不回收，默认为0
   * @param {number} options.autoGcLimit 打开的browser超过autoGcLimit时才开启自动回收, 默认20
   * @param {number} options.pageLoadingTimeout 页面加载超时时间, 默认10s
   * @param {boolean} options.createPage 是否新建默认page
   * @param {boolean} [options.devtools] 是否打开控制台
   * @param {string} [options.partition] session标识，相同的partition共享登录状态
   * @param {string} [options.userAgent] userAgent
   * @param {boolean} [options.allowPopups] allowPopups
   * @param {string} options.preload preload, 理论上必须为当前包的preload/webivew.preload.js, 否则无法通信
   * @param {string} [options.startUrl] 新建tab的初始页面, 不传则为abount:blank
   * @param {string} [options.startUrlReferrer] 打开的startUrl的referrer
   * @param {string} [options.webpreferences] 网页功能的设置
   * @param {array} [options.plugins] browser拓展
   */
  constructor(browserManager, options) {
    super()

    this.isReady = false
    this.isFront = false
    this.id = uniqueId("browser_")
    this.startTime = Date.now()
    this._pages = []
    this.browserManager = browserManager
    this.closed = false
    this.options = options
    this._pluginsStatus = new Map()
  }
  /**
   * Browser的初始化
   * @async
   */
  async init() {
    this._handleWindowPage()
    this.build()
    if (this.options.createPage) {
      await this.newPage()
    }
    this.isReady = true
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
    // 如果没有需要显示的plugins，就不插入plugins按钮
    const pluginsHtml =
      this.options.plugins &&
      this.options.plugins.length &&
      this.options.plugins.some(
        (item) =>
          item.visible == null ||
          (typeof item.visible === "function" ? item.visible() : !!item.visible)
      )
        ? `<div class="chrome-tabs-button chrome-tabs-button-plugins" title="拓展功能">
      <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false"><path d="M431.55 98.021h-255.335c-30.555 0-55.327 24.703-55.327 55.169v254.606c0 30.469 24.772 55.169 55.327 55.169h255.335c30.554 0 55.327-24.7 55.327-55.169v-254.606c0-30.466-24.773-55.169-55.327-55.169v0zM431.55 98.021z" p-id="5974" fill="#515151"></path><path d="M431.55 513.227h-255.335c-30.555 0-55.327 24.704-55.327 55.169v254.607c0 30.474 24.772 55.169 55.327 55.169h255.335c30.554 0 55.327-24.7 55.327-55.169v-254.607c0-30.464-24.773-55.169-55.327-55.169v0zM431.55 513.227z" p-id="5975" fill="#515151"></path><path d="M845.712 98.021h-255.337c-30.554 0-55.326 24.703-55.326 55.169v254.606c0 30.469 24.772 55.169 55.326 55.169h255.337c30.558 0 55.326-24.7 55.326-55.169v-254.606c0-30.466-24.768-55.169-55.326-55.169v0zM845.712 98.021z" p-id="5976" fill="#515151"></path><path d="M845.712 513.227h-255.337c-30.554 0-55.326 24.704-55.326 55.169v254.607c0 30.474 24.772 55.169 55.326 55.169h255.337c30.558 0 55.326-24.7 55.326-55.169v-254.607c0-30.464-24.768-55.169-55.326-55.169v0zM845.712 513.227z" p-id="5977" fill="#515151"></path></svg>
    </div>`
        : ""
    const template = `
			<div class="electron-puppeteer-browser">
        <div class="chrome-tabs">
          <div class="chrome-tabs-ctrl">
            <div class="chrome-tabs-button chrome-tabs-button-back" title="后退" disabled>
              <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false"><path d="M224 480h640q14.016 0 23.008 8.992T896 512t-8.992 23.008T864 544H224q-14.016 0-23.008-8.992T192 512t8.992-23.008T224 480z m12.992 32l266.016 264.992Q512 787.008 512 800t-9.504 22.496T480 832t-23.008-8.992l-288-288Q160 524.992 160 512t8.992-23.008l288-288Q467.008 192 480 192t22.496 9.504T512 224t-8.992 23.008z" p-id="3843"></path></svg>
            </div>
            <div class="chrome-tabs-button chrome-tabs-button-forward" title="前进" disabled>
              <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false"><path d="M755.008 480H160q-14.016 0-23.008 8.992T128 512t8.992 23.008T160 544h595.008l-234.016 232.992Q512 787.008 512 800t9.504 22.496T544 832t23.008-8.992l288-288Q864 524.992 864 512t-8.992-23.008l-288-288Q556.992 192 544 192t-22.496 9.504T512 224t8.992 23.008z" p-id="4119"></path></svg>
            </div>
            <div class="chrome-tabs-button chrome-tabs-button-refresh" title="重新加载">
              <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false"><path d="M702.2725 747.5927c-52.8855 37.5183-114.7638 56.3272-178.0214 55.4609-8.364-0.0881-16.6707-0.5274-24.875-1.2585-3.3536-0.3205-6.7092-0.8765-10.0782-1.3015-6.4604-0.8663-12.9352-1.7428-19.2215-2.9747-3.8973-0.7475-7.7046-1.7582-11.5128-2.6522-6.1676-1.4664-12.3075-2.945-18.3265-4.7606-2.901-0.9083-5.7272-1.9487-8.5985-2.9297-6.9437-2.3583-13.8588-4.7892-20.5967-7.6462-1.5227-0.6175-2.988-1.3455-4.5117-2.0367-7.852-3.5021-15.6457-7.1772-23.1465-11.308-0.3656-0.1915-0.6738-0.3523-1.0394-0.5407-25.4464-14.1527-48.7393-31.8188-69.1599-52.4605-0.3082-0.3205-0.6451-0.7035-0.981-1.0691-6.3437-6.4471-12.3935-13.185-18.1514-20.2158-1.2012-1.495-2.3736-3.1058-3.5891-4.6438-41.5601-52.6479-66.6255-119.2745-66.6255-191.7614l70.498304 0c1.8207 0 3.583-0.9759 4.5066-2.6911 0.9247-1.7152 0.77-3.7233-0.2314-5.2449L180.1073 307.5871c-0.9155-1.3896-2.4893-2.304-4.2762-2.304s-3.3618 0.9155-4.2762 2.304L53.0493 487.554c-1.0015 1.5217-1.1551 3.5297-0.2314 5.2449 0.9247 1.7152 2.686 2.6911 4.5076 2.6911l70.51264 0c0 85.2163 26.2369 164.2045 70.8147 229.5122 0.5427 0.9103 0.938 1.877 1.538 2.7863 4.6141 6.6785 9.7423 12.8461 14.6934 19.1601 1.8463 2.388 3.5748 4.8476 5.4938 7.1905 7.296 8.9661 15.0446 17.3896 23.0144 25.6225 0.7619 0.8202 1.4653 1.6251 2.2129 2.3583 26.75 27.1155 57.001 49.9702 89.9031 68.2373 0.8499 0.514 1.6998 1.0424 2.6368 1.5247 9.4781 5.1548 19.2195 9.814 29.0939 14.2244 2.4617 1.068 4.864 2.2702 7.3687 3.326 8.4388 3.5451 17.11 6.6499 25.856 9.6102 4.1308 1.4213 8.233 2.8713 12.4221 4.1738 7.6329 2.2856 15.4409 4.2045 23.3216 6.0938 5.2152 1.2308 10.3997 2.5641 15.7194 3.5891 2.2118 0.4547 4.2916 1.1438 6.4614 1.4797 7.4117 1.3332 14.8828 2.0797 22.3099 2.988 2.6808 0.3236 5.3176 0.7782 7.9995 1.0691 13.3458 1.3343 26.6465 2.2118 39.935 2.2118 81.3189 0 160.6605-25.1812 228.7196-73.4515 21.6832-15.4245 26.9722-45.6899 11.7801-67.6792C753.8964 737.4848 723.9537 732.1672 702.2725 747.5927M927.9171 495.49c-0.044-84.951-26.1202-163.7806-70.4778-228.9551-0.6451-1.1131-1.0854-2.2415-1.8156-3.2819-5.5081-7.9688-11.5313-15.3969-17.5206-22.8383-0.6881-0.9083-1.3322-1.8606-2.0654-2.7546-40.5955-49.8668-91.5589-88.3804-149.3217-113.5616-1.5985-0.7035-3.1642-1.4797-4.7749-2.1832-9.216-3.838-18.6655-7.2366-28.1559-10.4448-3.4284-1.1428-6.783-2.4023-10.284-3.4427-8.277-2.5344-16.6717-4.5998-25.1402-6.5782-4.6725-1.0988-9.345-2.2999-14.078-3.2369-2.3429-0.4547-4.5548-1.1571-6.869-1.5821-6.314-1.0988-12.6577-1.5821-18.986-2.4166-4.395-0.5571-8.6733-1.2452-13.097-1.6998-10.6353-0.9964-21.1845-1.4203-31.7307-1.6108-1.9343 0-3.7939-0.3082-5.7129-0.3082-0.3512 0-0.6728 0.1034-1.025 0.1321C445.6448 90.7858 366.4794 115.6168 298.5062 163.8277c-21.7395 15.3815-27.0285 45.6765-11.8221 67.6803 15.1767 22.0037 45.1635 27.3357 66.859 11.9091 52.5036-37.2234 113.7531-56.063 176.5704-55.4916 9.0388 0.0584 17.9313 0.512 26.7213 1.3476 2.7095 0.3082 5.3914 0.7178 8.0855 1.0547 7.2233 0.894 14.3862 1.9333 21.4456 3.3403 3.1212 0.6154 6.1983 1.4203 9.2426 2.1248 6.9304 1.5811 13.8455 3.2809 20.6131 5.3473 2.1381 0.6881 4.2465 1.4643 6.3857 2.1678 7.721 2.5631 15.3231 5.3176 22.7963 8.4675 0.7598 0.3215 1.538 0.7178 2.2702 1.025 44.7386 19.4836 83.9854 49.4715 114.603 87.0031 0.1915 0.2191 0.3799 0.513 0.5571 0.7322 43.0981 53.119 69.0432 121.0184 69.0719 194.9542l-70.528 0c-1.8207 0-3.583 0.9759-4.5066 2.6911s-0.77 3.7233 0.2324 5.2449l118.5321 179.9537c0.9155 1.3885 2.4893 2.304 4.2772 2.304 1.7869-0.001 3.3608-0.9165 4.2752-2.305l118.4768-179.9537c1.0025-1.5217 1.1561-3.5287 0.2314-5.2449-0.9236-1.7152-2.686-2.6911-4.5066-2.6911L927.917056 495.489 927.9171 495.49z" p-id="7196"></path></svg>
            </div>
            <div class="chrome-tabs-button chrome-tabs-button-home" title="跳转至默认页面">
              <svg viewBox="0 0 1024 1024" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false"><path d="M745.6768 920.7808H297.5744a122.368 122.368 0 0 1-122.2656-122.4704V369.664h81.5104v428.6464a40.96 40.96 0 0 0 40.7552 40.96h448.1024a40.96 40.96 0 0 0 40.7552-40.96V369.664h81.3056v428.6464a122.32704 122.32704 0 0 1-122.0608 122.4704z m179.2-379.4944L550.2976 166.0928a40.5504 40.5504 0 0 0-57.5488 0L118.1696 541.2864l-57.5488-57.5488L435.2 108.3392a122.24512 122.24512 0 0 1 172.8512 0l374.3744 375.3984z" p-id="7077"></path></svg>
            </div>
            ${pluginsHtml}
          </div>
          <div class="chrome-tabs-content"></div>
          <div class="chrome-tabs-button chrome-tabs-button-add" title="打开新的标签页">
            <svg viewBox="64 64 896 896" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false"><path d="M482 152h60q8 0 8 8v704q0 8-8 8h-60q-8 0-8-8V160q0-8 8-8z"></path><path d="M176 474h672q8 0 8 8v60q0 8-8 8H176q-8 0-8-8v-60q0-8 8-8z"></path></svg>
          </div>
					<div class="chrome-tabs-bottom-bar"></div>
				</div>
				<div class="electron-puppeteer-pages">
				</div>
			</div>
		`

    const div = document.createElement("div")
    div.innerHTML = template
    this.element = div.firstElementChild
    setDomAsOffsetParent(this.options.container)
    this.options.container.appendChild(this.element)

    this.doms = {
      tabsElm: this.element.querySelector(".chrome-tabs"),
      addBtn: this.element.querySelector(".chrome-tabs-button-add"),
      refreshBtn: this.element.querySelector(".chrome-tabs-button-refresh"),
      backBtn: this.element.querySelector(".chrome-tabs-button-back"),
      forwardBtn: this.element.querySelector(".chrome-tabs-button-forward"),
      homeBtn: this.element.querySelector(".chrome-tabs-button-home"),
      pluginsBtn: this.element.querySelector(".chrome-tabs-button-plugins"),
      ctrlIconsContainer: this.element.querySelector(".chrome-tabs-ctrl"),
      pagesContainer: this.element.querySelector(".electron-puppeteer-pages"),
    }

    if (this.options.tabs === false) {
      this.doms.tabsElm.style.display = "none"
      this.doms.pagesContainer.style.height = "100%"
    }

    this._initChromeTabs()
  }
  updateStartUrl(startUrl, startUrlReferrer) {
    this.options.startUrl = startUrl
    this.options.startUrlReferrer = startUrlReferrer
  }
  /**
   * 初始化顶部tab
   * @private
   */
  _initChromeTabs() {
    // ctrlIcons
    this._setCtrlIcons(this.options.ctrlIcons)

    let chromeTabs = (this._chromeTabs = new ChromeTabs())
    chromeTabs.init(this.doms.tabsElm)
    this.doms.tabsElm.addEventListener("activeTabChange", (evt) => {
      if (!evt.detail.trigger) {
        var pageId = evt.detail.tabEl.getAttribute("data-tab-id")
        var page = this.getPageById(pageId)
        page.bringToFront()
      }
    })
    this.doms.tabsElm.addEventListener("tabRemove", (evt) => {
      if (!evt.detail.trigger) {
        var pageId = evt.detail.tabEl.getAttribute("data-tab-id")
        var page = this.getPageById(pageId)
        page.$tabEl = null
        page.close()
      }
    })

    // 按钮事件
    this.doms.addBtn.addEventListener("click", () => {
      this.newPage()
    })
    this.doms.refreshBtn.addEventListener("click", () => {
      let frontPage = this.frontPage()
      if (this.isFront && frontPage) {
        frontPage.reload()
      }
    })
    this.doms.homeBtn.addEventListener("click", () => {
      let frontPage = this.frontPage()
      if (this.isFront && frontPage) {
        frontPage.goHome()
      }
    })
    this.doms.backBtn.addEventListener("click", () => {
      let frontPage = this.frontPage()
      if (this.isFront && frontPage) {
        frontPage.goBack()
      }
    })
    this.doms.forwardBtn.addEventListener("click", () => {
      let frontPage = this.frontPage()
      if (this.isFront && frontPage) {
        frontPage.goForward()
      }
    })
    if (this.doms.pluginsBtn) {
      let storeKeyPrefix = "electron-puppeteer/plugins/"
      this.options.plugins.forEach((item) => {
        let storeKey = storeKeyPrefix + item.key
        let checked = item.checked || store.get(storeKey) || false
        this._pluginsStatus.set(item.key, checked)
      })
      this.doms.pluginsBtn.addEventListener("click", () => {
        const menu = new Menu()
        ;(this.options.plugins || []).forEach((item) => {
          let checked = this._pluginsStatus.get(item.key) || false
          let menuItem = new MenuItem({
            label: item.title,
            type: "checkbox",
            checked: checked,
            icon: item.icon,
            visible:
              item.visible == null ||
              (typeof item.visible === "function"
                ? item.visible()
                : !!item.visible),
            click: () => {
              let storeKey = storeKeyPrefix + item.key
              let checked = this._pluginsStatus.get(item.key)
              checked = !checked
              this._pluginsStatus.set(item.key, checked)
              store.set(storeKey, checked)

              if (checked) {
                this.emit("plugin.on", item.key)
              } else {
                this.emit("plugin.off", item.key)
              }
            },
          })
          menu.append(menuItem)
        })

        menu.popup({window: currentWindow})
      })
    }

    // 定时器： 用于更新前进后退的状态
    this._backForwardTimer = setInterval(() => {
      if (!document.body.contains(this.element)) {
        this.close()
        return
      }

      let frontPage = this.frontPage()
      if (this.isFront && frontPage) {
        if (frontPage.canGoBack()) {
          this.doms.backBtn.removeAttribute("disabled")
        } else {
          this.doms.backBtn.setAttribute("disabled", true)
        }
        if (frontPage.canGoForward()) {
          this.doms.forwardBtn.removeAttribute("disabled")
        } else {
          this.doms.forwardBtn.setAttribute("disabled", true)
        }
      }
    }, 500)
  }
  isVisible() {
    return isElementInViewport(this.element)
  }
  layoutTabs() {
    this._chromeTabs.layoutTabs()
  }
  /**
   * 处理新窗口打开的windowPage
   */
  _handleWindowPage() {
    remote.ipcMain.on(
      BROWSER_WINDOW_PAGE_CONNECT,
      (evt, {openerWebContentsId, url, register}) => {
        let opener = this.getPageByWebContentsId(openerWebContentsId)
        if (opener) {
          let page = new WindowPage(
            this,
            {
              ...this.options,
              url,
            },
            evt.sender
          )
          this._initPage(page, opener)
          page._reissueRegisterMessage(register)
        }
      }
    )
  }
  _doBack() {
    this._hideTimeStart = Date.now()
    this.isFront = false
    this.element.style.zIndex = -1

    // 自动回收
    if (this.options.autoGcTime) {
      this._gcTimer = setTimeout(() => {
        let autoGcLimit = this.options.autoGcLimit || 20
        // 仅当打开的browser超过20个时才回收
        if (this.browserManager.size > autoGcLimit) {
          this.close()
        }
      }, this.options.autoGcTime)
    }

    /**
     * 当前browser取消激活时触发
     * @event Browser#back
     */
    this.emit("back")
  }
  _doFront() {
    if (this._gcTimer) {
      clearTimeout(this._gcTimer)
    }

    this._hideTimeStart = 0
    this.isFront = true
    this.element.style.zIndex = 1
    // 每次切换browser的时候强制重新布局，防止当前browser不可见时导致的tab样式错乱
    this._chromeTabs.layoutTabs()

    /**
     * 当前browser激活时触发
     * @event Browser#front
     */
    this.emit("front")
  }
  openedPlugins() {
    let opened = []
    this._pluginsStatus.forEach((status, key) => {
      if (status) {
        opened.push(key)
      }
    })
    return opened
  }
  /**
   * 闲置时间
   * 当前非激活时长，激活时会被清0
   *
   * @return {number} 单位为ms
   */
  get idleTime() {
    if (this.isFront || !this.isReady) {
      return 0
    }

    return Date.now() - this._hideTimeStart
  }
  /**
   * 将browser提到视窗最前端，相当于多个browser，切换到当前
   */
  bringToFront() {
    this.browserManager._bringBrowserToFront(this.id)
  }
  isClosed() {
    return this.closed
  }
  /**
   * 关闭browser
   */
  close() {
    this.closed = true
    this._pages.forEach((page) => {
      page.close()
    })

    clearInterval(this._backForwardTimer)
    this.options.container.removeChild(this.element)
    this.browserManager._removeBrowser(this.id)

    /**
     * 当前browser关闭时触发
     * @event Browser#close
     */
    this.emit("close", this.id)

    setTimeout(() => this.removeAllListeners(), 0)
  }
  /**
   * 获取browser下的所有page实例集合
   *
   * @return {Page[]}
   */
  pages() {
    return this._pages.slice(0)
  }
  /**
   * 通过pageid获取指定page实例
   *
   * @return {Page}
   */
  getPageById(pageId) {
    return this._pages.find((item) => item.id === pageId)
  }
  getPageByWebContentsId(webContentsId) {
    return this._pages.find((item) => item.getWebContentsId() === webContentsId)
  }
  /**
   * 获取当前激活的page
   *
   * @return {Page}
   */
  frontPage() {
    return this._pages.find((item) => item.isFront === true)
  }
  /**
   * 新建页面
   * @param {string} [url] 页面跳转地址，不传则跳转到browser的startUrl
   * @param {Object} options 传入配置, 用于覆盖browser的配置
   * @param {number} options.pageLoadingTimeout 页面加载超时时间, 默认10s
   * @param {boolean} [options.devtools] 是否打开控制台
   * @param {string} [options.partition] session标识，相同的partition共享登录状态
   * @param {string} [options.userAgent] userAgent
   * @param {boolean} [options.allowPopups] allowPopups
   * @param {string} options.preload preload, 理论上必须为当前包的preload/webivew.preload.js, 否则无法通信
   * @param {string} [options.webpreferences] 网页功能的设置
   * @param {string} [referrer] referrer，不传则为browser的startUrlReferrer
   *
   * @return {Promise<Page>} 返回构建的page实例
   */
  newPage(url, options) {
    let page = this._newPageWithoutReady(null, url, options)
    return page._waitForReady().then(() => page)
  }
  /**
   * 自定义操作图标
   */
  _setCtrlIcons(ctrls) {
    if (Array.isArray(ctrls)) {
      let frag = document.createDocumentFragment()
      ctrls.forEach((ctrl) => {
        let el = parseStrToDOM(
          `<div class="chrome-tabs-button chrome-tabs-button-custom"></div>`
        )
        if (ctrl.desc) {
          el.setAttribute("title", ctrl.desc)
        }

        switch (ctrl.type) {
          case "newTab":
            el.addEventListener("click", () => {
              this.newPage(ctrl.url)
            })
            break
          // 固定标签页
          case "fixedTab":
            el.addEventListener("click", () => {
              this.emit("ctrl", {
                el: el,
                ctrl: ctrl,
              })
              let pageId = el.getAttribute("data-tab-id")
              if (pageId) {
                this._bringPageToFront(pageId)
                return
              }

              this._newPageWithoutReady(null, ctrl.url, null, function (page) {
                page.$tabEl = el
                el.setAttribute("data-tab-id", page.id)
                page.on("back", () => {
                  el.removeAttribute("active")
                })
              })
            })
            break
          // 自定义
          case "custom":
          default:
            el.addEventListener("click", (evt) => {
              ctrl.click && ctrl.click(evt, this)
            })
            break
        }

        el.addEventListener("click", () => {
          this.emit("ctrl.click", {el, ctrl})
        })
        el.appendChild(parseStrToDOM(ctrl.icon))
        frag.appendChild(el)
      })

      if (this.doms.pluginsBtn) {
        this.doms.ctrlIconsContainer.insertBefore(frag, this.doms.pluginsBtn)
      } else {
        this.doms.ctrlIconsContainer.appendChild(frag)
      }
    }
  }
  _initPage(page, opener) {
    /**
     * 当前browser新建page时触发, 此时page还未构建完毕
     * @event Browser#new-page
     * @type {Page}
     */
    this.emit("new-page", page)

    let target = new Target(page, opener)
    /**
     * 打开新标签页时触发
     * @event Browser#targetcreated
     * @type {Target}
     */
    this.emit("targetcreated", target)
    page.on("connect", () => {
      /**
       * 打开的页面url变更时触发
       * @event Browser#targetchanged
       * @type {Target}
       */
      this.emit("targetchanged", target)
    })
    page.once("close", () => {
      /**
       * 新打开的页面关闭时触发
       * @event Browser#targetdestroyed
       * @type {Target}
       */
      this.emit("targetdestroyed", target)
    })

    page.init()
    this._pages.push(page)
  }
  /**
   * 新建页面, 不等待页面加载完成
   * @param {Target} opener 打开当前页面的opener
   * @param {string} [url] 页面跳转地址，不传则跳转到browser的startUrl
   * @param {Object} options 传入配置
   * @param {function} [handlerTab] tab状态更新
   * @param {boolean} [isBack] 不切换到对应tab页
   *
   * @return {Page} 返回构建的page实例
   */
  _newPageWithoutReady(opener, url, options, handlerTab, isBack) {
    options = options || {}
    var page = new Page(this, {
      container: this.doms.pagesContainer,
      url: url,
      partition: options.partition || this.options.partition,
      userAgent: options.userAgent || this.options.userAgent,
      allowPopups: options.allowPopups || this.options.allowPopups,
      devtools: options.devtools || this.options.devtools,
      preload: options.preload || this.options.preload,
      loadingTimeout:
        options.pageLoadingTimeout || this.options.pageLoadingTimeout,
      referrer: options.referrer,
      startUrl: this.options.startUrl,
      startUrlReferrer: this.options.startUrlReferrer,
      webpreferences: options.webpreferences || this.options.webpreferences,
    })

    this._initPage(page, opener)

    if (typeof handlerTab === "function") {
      handlerTab(page)
    } else {
      this._handlePageTab(page)
    }

    if (!isBack) {
      page.bringToFront()
    }

    return page
  }
  /**
   * page对应tab的右键菜单，图标及标题的更新
   * @private
   * @param {Page} page
   */
  _handlePageTab(page) {
    let elm = (page.$tabEl = this._chromeTabs.addTab(
      {
        id: page.id,
        title: "加载中……",
        url: page.url(),
        favicon: loadingGif,
      },
      {
        background: true,
      }
    ))

    elm.addEventListener("contextmenu", () => {
      this._showTabMenu(page)
    })

    let pageIcon = faviconPng
    let pageTitle
    page.on("load-start", () => {
      this._chromeTabs.updateTab(page.$tabEl, {
        title: "加载中……",
        url: page.url(),
        favicon: loadingGif,
      })
    })
    page.on("favicon-updated", (evt) => {
      pageIcon = evt.favicon
      this._chromeTabs.updateTab(page.$tabEl, {
        favicon: pageIcon,
        url: page.url(),
      })
      var img = new Image()
      img.src = pageIcon
      img.onerror = () => {
        pageIcon = faviconPng
        this._chromeTabs.updateTab(page.$tabEl, {
          favicon: faviconPng,
          url: page.url(),
        })
        img.onerror = null
        img = null
      }
    })
    page.on("title-updated", (evt) => {
      pageTitle = evt.title
      this._chromeTabs.updateTab(page.$tabEl, {
        title: pageTitle,
        url: page.url(),
      })
    })
    page.on("load-end", () => {
      this._chromeTabs.updateTab(page.$tabEl, {
        favicon: pageIcon,
        title: pageTitle,
        url: page.url(),
      })
    })
    page.on("new-window", (evt) => {
      if (
        !this.options.allowPopups ||
        (evt.disposition !== "new-window" &&
          evt.disposition !== "foreground-tab")
      ) {
        evt.preventDefault()
        this._newPageWithoutReady(
          page,
          evt.url,
          {
            referrer: page.url(),
          },
          null,
          evt.disposition === "background-tab"
        )
      }
    })
    page.on("foreground-tab", ({proxyId, url, referrer}) => {
      let newPage = this._newPageWithoutReady(page, url, {
        referrer,
      })
      newPage._initWindowProxy(proxyId, page)
    })
  }
  /**
   * tab的右键菜单
   * @private
   * @param {Page} page
   */
  _showTabMenu(page) {
    const isMac = process.platform === "darwin"
    const CommandOrControl = isMac ? "⌘" : "Ctrl"
    //右键菜单
    const menu = new Menu()
    menu.append(
      new MenuItem({
        label: `重新加载                   ${CommandOrControl}+R`,
        click: () => {
          page.reload()
        },
      })
    )
    menu.append(
      new MenuItem({
        label: "复制",
        click: () => {
          this.newPage(page.url(), {referrer: page.url()})
        },
      })
    )
    menu.append(
      new MenuItem({
        type: "separator",
      })
    )
    menu.append(
      new MenuItem({
        label: "复制链接",
        click: () => {
          clipboard.writeText(page.url())
        },
      })
    )
    menu.append(
      new MenuItem({
        type: "separator",
      })
    )
    menu.append(
      new MenuItem({
        label: "前进",
        enabled: page.canGoForward(),
        click: () => {
          page.goForward()
        },
      })
    )
    menu.append(
      new MenuItem({
        label: "后退",
        enabled: page.canGoBack(),
        click: () => {
          page.goBack()
        },
      })
    )
    menu.append(
      new MenuItem({
        type: "separator",
      })
    )
    menu.append(
      new MenuItem({
        label: `关闭                           ${CommandOrControl}+W`,
        click: () => {
          page.close()
        },
      })
    )
    menu.append(
      new MenuItem({
        label: "关闭其它",
        click: () => {
          this._pages
            .filter((item) => item.id !== page.id)
            .forEach((item) => item.close())
        },
      })
    )
    menu.popup({window: currentWindow})
  }
  /**
   * 删除页面，不可直接调用
   * 如需要关闭页面，请调用page.close()
   * @private
   * @param {string} pageId
   */
  _removePage(pageId) {
    var index = this._pages.findIndex((page) => page.id === pageId)
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
    this._pages.forEach((page) => {
      if (pageId === page.id) {
        if (page.$tabEl) {
          this._chromeTabs.setCurrentTab(page.$tabEl, true)
        }
        page._doFront()
      } else {
        page._doBack()
      }
    })
  }
}
