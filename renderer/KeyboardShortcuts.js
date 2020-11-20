import {register} from "./libs/localshortcutswrap"

const shortcuts = [
  {
    action: "closePage",
    keys: "CommandOrControl+W",
  },
  {
    action: "newPage",
    keys: "CommandOrControl+T",
  },
  {
    action: "reload",
    keys: "CommandOrControl+R",
  },
  {
    action: "toggleDevtools",
    keys: "F12",
  },
  {
    action: "search",
    keys: "CommandOrControl+F",
  },
  {
    action: "zoomOut",
    keys: "CommandOrControl+-",
  },
  {
    action: "zoomIn",
    keys: ["CommandOrControl+=", "CommandOrControl+Plus"],
  },
  {
    action: "zoomReset",
    keys: "CommandOrControl+0",
  },
]

export default class KeyboardShortcuts {
  constructor(browserManger) {
    this.init(browserManger)
  }
  init(browserManger) {
    this.browserManger = browserManger
    shortcuts.forEach((item) => {
      ;[].concat(item.keys).forEach((key) => {
        register(key, this[item.action], {ctx: this})
      })
    })
  }
  _getFrontBrowser() {
    let browser = this.browserManger.frontBrowser()
    if (!browser || !browser.isVisible()) {
      return null
    }
    return browser
  }
  _getFrontPage() {
    let browser = this._getFrontBrowser()
    if (!browser) {
      return null
    }
    return browser.frontPage()
  }
  newPage() {
    let browser = this._getFrontBrowser()
    if (browser) {
      browser.newPage()
    }
  }
  closePage() {
    let frontPage = this._getFrontPage()
    if (frontPage) {
      frontPage.close()
    }
  }
  reload() {
    let frontPage = this._getFrontPage()
    if (frontPage && frontPage.isReady) {
      frontPage.reload()
    }
  }
  toggleDevtools() {
    let frontPage = this._getFrontPage()
    if (frontPage && frontPage.isReady) {
      if (frontPage.webview.isDevToolsOpened()) {
        frontPage.webview.closeDevTools()
      } else {
        frontPage.webview.openDevTools()
      }
    }
  }
  search() {
    let frontPage = this._getFrontPage()
    if (frontPage && frontPage.isReady) {
      frontPage.chromeSearch.show()
    }
  }
  zoomOut() {
    let frontPage = this._getFrontPage()
    if (frontPage && frontPage.isReady) {
      frontPage.chromeZoom.zoomOut()
    }
  }
  zoomIn() {
    let frontPage = this._getFrontPage()
    if (frontPage && frontPage.isReady) {
      frontPage.chromeZoom.zoomIn()
    }
  }
  zoomReset() {
    let frontPage = this._getFrontPage()
    if (frontPage && frontPage.isReady) {
      frontPage.chromeZoom.zoomReset()
    }
  }
}
