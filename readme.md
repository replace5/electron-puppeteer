# electron-puppeteer

> electron webview 的驱动，Api 和 puppeteer 高度相似

## 效果预览

![预览图](https://s1.ax1x.com/2020/05/11/YG5p7T.gif)

## 基础使用

> **注意** webview.preload.js 必须是`file`或`asar`协议

```javascript
// set the script type="module"
const path = require("path")
const electronPuppeteer = require("electron-puppeteer").default

async function run() {
  // open a browser
  const browser = await electronPuppeteer.launch({
    // container must has height, example: `<div id="container" style="height: 100vh"></div>`
    container: document.getElementById("container"),
    startUrl: "https://segmentfault.com/",
    createPage: true,
    partition: "persist:test",
    // webview.preload.js的路径
    preload:
      "file://" +
      path.join(
        __dirname,
        "node_modules/electron-puppeteer/preload/webview.preload.js",
      ),
  })

  const pages = await browser.pages()
  const page = pages[0]
  // input search text
  let $search = await page.$("#searchBox")
  let word = "electron"
  for (let i = 0; i < word.length; i++) {
    let c = word.charAt(i)
    await $search.press(c)
  }
  // click search button
  await page.click(".header-search button")

  const page2 = await browser.newPage()
  await page2.goto("https://segmentfault.com/blogs")
}

run()
```

### 切换多个 browser

```javascript
  const path = require("path")
  import electronPuppeteer from "./node_modules/electron-puppeteer/renderer/index.js"

  const browserMap = new Map()
  function showBrowser(name) {
    const browser = browserMap.get(name)
    if (!browser) {
      browser = await electronPuppeteer.launch({
        container: document.getElementById('container'),
        preload: "file://" +
          path.join(
            __dirname,
            "node_modules/electron-puppeteer/preload/webview.preload.js",
          ),
      })
      // do something
    }
    browser.bringToFront()
  }
```

### [Api](./doc/index.html)

## Demo

> node 版本建议在 v11+

1. 到 demo 目录运行`npm install`
2. 运行 npm start

## 注意事项

> 所属 BrowserWindow 的 webPreferences.nodeIntegration 需要为 true，否则无法获取和操作 webivew 下的 iframe  
> 所属 BrowserWindow 的 webPreferences.devtools 不能为 false，否则 launch 时传入 devtools 将无效  
> launch 时传入的 webPreferences 属性都必须在 BrowserWindow 内配置，否则无法单独生效
