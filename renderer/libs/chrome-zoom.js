import {parseStrToDOM, importStyle} from "../util"

// 缩放刻度
const zoomOutFactors = [90, 80, 75, 67, 50, 33, 25]
const zoomInFactors = [110, 125, 150, 175, 200, 250, 300, 400, 500]

export default class ChromeZoom {
  constructor(page) {
    this.page = page
    this.webview = page._getWebview()

    this.doms = {}
    this.value = ""
    this.zoomFactorIndex = 0
    this.created = false
    this.hideTimer = null

    this.page.once("dom-ready", () => {
      let webContents = this.page.getWebContents()
      webContents.on("zoom-changed", (_, zoomDirection) => {
        switch (zoomDirection) {
          case "in":
            this.zoomIn()
            break
          case "out":
            this.zoomOut()
            break
        }
      })
    })
  }
  create() {
    let container = parseStrToDOM(`
      <div class="chrome-zoom">
        <span class="chrome-zoom-text">100%</span>
        <span class="chrome-zoom-out">${icon.out}</span>
        <span class="chrome-zoom-in">${icon.in}</span>
        <span class="chrome-zoom-reset">重置</span>
      </div>
		`)

    let doms = (this.doms = {
      container,
      text: container.querySelector(".chrome-zoom-text"),
      out: container.querySelector(".chrome-zoom-out"),
      in: container.querySelector(".chrome-zoom-in"),
      reset: container.querySelector(".chrome-zoom-reset"),
    })

    doms.out.addEventListener("click", this.zoomOut.bind(this), false)
    doms.in.addEventListener("click", this.zoomIn.bind(this), false)
    doms.reset.addEventListener("click", this.zoomReset.bind(this), false)
    this.page._getDOM().appendChild(container)
  }
  zoomOut() {
    if (zoomOutFactors.length + this.zoomFactorIndex <= 0) {
      return
    }

    this.zoomFactorIndex -= 1
    this.zoom()
  }
  zoomIn() {
    if (zoomOutFactors.length - this.zoomFactorIndex + 1 < 0) {
      return
    }

    this.zoomFactorIndex += 1
    this.zoom()
  }
  zoomReset() {
    this.zoomFactorIndex = 0
    this.zoom()
  }
  zoom() {
    this.zoomFactorIndex = Math.min(
      Math.max(-zoomOutFactors.length, parseInt(this.zoomFactorIndex, 10)),
      zoomInFactors.length
    )
    let zoomFactor = 100
    if (this.zoomFactorIndex < 0) {
      zoomFactor = zoomOutFactors[Math.abs(this.zoomFactorIndex) - 1]
    } else if (this.zoomFactorIndex > 0) {
      zoomFactor = zoomInFactors[this.zoomFactorIndex - 1]
    }

    if (this.webview) {
      this.webview.setZoomFactor(zoomFactor / 100)
    }
    this.show()
    this.doms.text.textContent = zoomFactor + "%"
  }
  show() {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
    }
    this.hideTimer = setTimeout(() => {
      this.hide()
    }, 2e3)

    if (!this.created) {
      this.created = true
      this.create()
    }
  }
  hide() {
    this.destroy()
    this.created = false
  }
  destroy() {
    let doms = this.doms
    doms.container.remove()
  }
}

const icon = {
  out: `<svg t="1599466215124" class="icon" viewBox="0 0 1024 1024" width="12" height="12"><path d="M85.333333 426.666667m64 0l725.333334 0q64 0 64 64l0 0q0 64-64 64l-725.333334 0q-64 0-64-64l0 0q0-64 64-64Z" p-id="11877"></path></svg>`,
  in: `<svg t="1599474420254" class="icon" viewBox="0 0 1024 1024" width="12" height="12"><path d="M597.376022 597.375991h383.917732c23.546954 0 42.63315-25.521388 42.63315-56.892952V483.516961c0-31.44469-19.086196-56.892952-42.63315-56.892952h-383.917732V42.779404C597.376022 19.23245 571.854634 0.146254 540.483071 0.146254H483.516992c-31.44469 0-56.892952 19.086196-56.892952 42.63315v383.917732H42.779436c-23.546954 0-42.63315 25.521388-42.63315 56.892952v56.892951c0 31.44469 19.086196 56.892952 42.63315 56.892952h383.917732v383.917732c0 23.546954 25.521388 42.63315 56.892951 42.63315h56.892952c31.44469 0 56.892952-19.086196 56.892951-42.63315v-383.917732z" p-id="6099"></path></svg>`,
}

importStyle(
  `
	.chrome-zoom {
		position: absolute;
		display: flex;
		top: 0;
		right: 30px;
		width: 256px;
    height: 42px;
    line-height: 30px;
		background: #fff;
		padding: 5px 15px;
		user-select:none;
		box-shadow: -3px 1px 4px #e3e3e3;
		border: 1px solid #e3e3e3;
    font-size: 12px;
    color: #000;
  }
  .chrome-zoom-text {
    width: 100px;
    text-align: left;
  }
  .chrome-zoom-in,
	.chrome-zoom-out {
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
	.chrome-zoom-in svg,
	.chrome-zoom-out svg {
		vertical-align: top;
	}
	.chrome-zoom-in:hover,
	.chrome-zoom-out:hover{
		background: #e3e3e3;
	}
	.chrome-zoom-in:active,
	.chrome-zoom-out:active {
		background: #f7f5f5;
	}
  .chrome-zoom-reset {
    color: rgb(26, 115, 232);
    height: 30px;
    line-height: 28px;
    width: 64px;
    text-align: center;
    border: 1px solid rgb(218, 220, 224);
    border-radius: 2px;
    margin-left: 15px;
    cursor: pointer;
  }
`,
  "electron-puppeteer-chrome-zoom"
)
