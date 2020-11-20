import {parseStrToDOM, importStyle, debounce} from "../util"
import {register, unregister} from "./localshortcutswrap"

export default class ChromeSearch {
  constructor(page) {
    this.page = page
    this.webview = page._getWebview()

    this.doms = {}
    this.value = ""
    this.needCreate = true

    this.evDelegateClick = this.evDelegateClick.bind(this)
    this.evKeyDown = this.evKeyDown.bind(this)
    this.evTextInput = this.evTextInput.bind(this)
    this.evEscClick = this.evEscClick.bind(this)
  }
  create() {
    let container = parseStrToDOM(`
				<div class="chrome-search">
						<input class="chrome-search-input" type="text" />
						<div class="chrome-search-count"></div>
						<div class="chrome-search-eparator"></div>
						<div class="chrome-search-pre" role="pre">${icon.pre}</div>
						<div class="chrome-search-next" role="next">${icon.next}</div>
						<div class="chrome-search-close" role="close">${icon.close}</div>
				</div>
		`)

    let doms = (this.doms = {
      container,
      count: container.querySelector(".chrome-search-count"),
      textInput: container.querySelector(".chrome-search-input"),
    })

    container.addEventListener("click", this.evDelegateClick, false)
    doms.textInput.addEventListener("input", this.evTextInput, false)
    doms.textInput.addEventListener("keyup", this.evKeyDown, false)
    register("Esc", this.evEscClick, {only: true})
    this.page._getDOM().appendChild(container)
  }
  evDelegateClick(evt) {
    let target = evt.target
    let currentTarget = evt.currentTarget

    let role
    while (!role && target !== currentTarget) {
      target = target.parentNode
      role = target.getAttribute("role")
    }

    switch (role) {
      case "pre":
        this.find({
          forward: false,
          findNext: true,
        })
        break
      case "next":
        this.find({
          forward: true,
          findNext: true,
        })
        break
      case "close":
        this.hide()
        break
    }
  }
  evTextInput(evt) {
    let value = (this.value = evt.target.value)
    if (!value) {
      return
    }

    this.debounceFind()
  }
  evKeyDown(evt) {
    if (evt.keyCode === 13) {
      this.find({
        forward: !evt.shiftKey,
        findNext: true,
      })
    }
  }
  evEscClick() {
    this.hide()
  }
  debounceFind = debounce(function (option) {
    this.find(option)
  }, 300)
  find(option) {
    let p = new Promise((resolve, reject) => {
      let timeoutId = setTimeout(() => reject("timeout"), 2e3)
      let onFounInPage = (e) => {
        let result = e.result
        if (result.requestId === requestId) {
          window.clearTimeout(timeoutId)
          this.webview.removeEventListener("found-in-page", onFounInPage)
          resolve(result)
        }
      }

      this.webview.addEventListener("found-in-page", onFounInPage)

      let requestId = this.webview.findInPage(this.value, option)
    })

    p.then((result) => {
      this.updateCount(result.activeMatchOrdinal, result.matches)
    }).catch((e) => {
      if (e === "timeout") {
        return e
      }
      throw e
    })
    return p
  }
  updateCount(current, count) {
    this.doms.count.innerText = `${current}/${count}`
  }
  show() {
    if (this.needCreate) {
      this.create()
      this.doms.textInput.focus()
      this.needCreate = false
    } else {
      this.doms.textInput.setSelectionRange(0, 99999)
    }
  }
  hide() {
    this.destroy()
    this.needCreate = true
  }
  destroy() {
    let doms = this.doms
    doms.container.removeEventListener("click", this.evDelegateClick)
    doms.textInput.removeEventListener("input", this.evTextInput)
    doms.container.remove()
    this.webview.stopFindInPage("clearSelection")
    unregister("Esc", this.evEscClick)
  }
}

const icon = {
  pre: `<svg t="1594027910855" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="12" height="12"><path d="M748.804657 1023.999977a38.297142 38.297142 0 0 1-27.154285-11.245714L248.004668 539.177131a38.388571 38.388571 0 0 1 0-54.297142L721.604658 11.28a38.422856 38.422856 0 0 1 54.399999 54.274284L329.501809 511.999989 776.004657 958.457121A38.399999 38.399999 0 0 1 748.850371 1023.999977z" p-id="853"></path></svg>`,
  next: `<svg t="1594027927273" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="12" height="12"><path d="M304.8 65.22c8.6 0 17.19 3.28 23.76 9.84l414.4 414.4c13.13 13.13 13.13 34.39 0 47.51l-414.4 414.4c-13.13 13.13-34.39 13.13-47.51 0-13.13-13.11-13.13-34.4 0-47.51l390.64-390.64-390.65-390.64c-13.13-13.13-13.13-34.39 0-47.51 6.57-6.57 15.16-9.85 23.76-9.85z" p-id="995"></path></svg>`,
  close: `<svg t="1594027937895" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="12" height="12"><path d="M562.43 513.02l355.33-355.33c13.66-13.64 13.66-35.79 0-49.43-13.66-13.66-35.78-13.66-49.43 0L513 463.58 157.67 108.26c-13.66-13.66-35.78-13.66-49.43 0-13.66 13.64-13.66 35.79 0 49.43l355.33 355.33-355.33 355.32c-13.66 13.66-13.66 35.78 0 49.43 6.83 6.83 15.77 10.24 24.72 10.24 8.94 0 17.89-3.41 24.72-10.24L513 562.45l355.33 355.33c6.83 6.83 15.77 10.24 24.72 10.24s17.89-3.41 24.72-10.24c13.66-13.66 13.66-35.78 0-49.43L562.43 513.02z" p-id="1137"></path></svg>`,
}

importStyle(
  `
	.chrome-search {
		position: absolute;
		display: flex;
		top: 0;
		right: 30px;
		width: 350px;
		height: 42px;
		background: #fff;
		padding: 5px 10px;
		user-select:none;
		box-shadow: -3px 1px 4px #e3e3e3;
		border: 1px solid #e3e3e3;
	}
	.chrome-search-input {
		border: none;
		flex: 1 0 200px;
	}
	.chrome-search-input:focus {
		outline: none;
	}
	.chrome-search-count {
		flex: 1 0 50x;
		margin-right: 2px;
		margin-left: 2px;
		text-align: center;
		line-height: 30px;
	}
	.chrome-search-eparator {
		width: 0;
		border-left: 1px solid #e3e3e3;
		margin-right: 2px;
		margin-left: 2px;
		height: 30px;
	}
	.chrome-search-pre,
	.chrome-search-next,
	.chrome-search-close {
		margin-top: 3px;
		margin-left: 5px;
		width: 24px;
		height: 24px;
		cursor: pointer;
		border-radius: 15px;
		text-align: center;
		padding: 6px 0;
		font-weight: bold;
		transition-duration: .3s;
		text-align: center;
	}
	.chrome-search-pre svg,
	.chrome-search-next svg,
	.chrome-search-close svg{
		vertical-align: top;
	}
	.chrome-search-pre svg,
	.chrome-search-next svg {
		transform: rotate(90deg);
	}
	.chrome-search-pre:hover,
	.chrome-search-next:hover,
	.chrome-search-close:hover{
		background: #e3e3e3;
	}
	.chrome-search-pre:active,
	.chrome-search-next:active,
	.chrome-search-close:active{
		background: #f7f5f5;
	}
`,
  "electron-puppeteer-chrome-search"
)
