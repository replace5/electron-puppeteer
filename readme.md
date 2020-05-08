# electron-puppeteer
> electron webview的驱动，Api和puppeteer高度相似

## 效果预览
![预览图](./screenshot/1.jpg)

## 基础使用

```javascript
import electronPuppeteer from "electron-puppeteer/renderer/"
async function run() {
  // 打开一个browser，通过partition设置独立的session空间
  const browser = await electronPuppeteer.launch({
    container: document.getElementById('container'),
    startUrl: 'https://www.google.com',
    partition: 'persist:test',
    // webview.preload.js的路径
    preload: 'file://electron-puppeteer/preload/webview.preload.js'
  })
  const page = await browser.newPage()
  await page.goto("https://www.youtube.com/")

  // 输入搜索内容
  let $search = await page.$("#search");
  let word = "test"
  for (let i = 0; i < word.length; i++) {
    let c = word.charAt(i)
    await $search.press(c)
  }
  // 点击搜索按钮
  await page.click("#search-icon-legacy")
}
```

### 切换多个browser
```javascript
  const browserMap = new Map()
  function showBrowser(name) {
    const browser = browserMap.get(name)
    if (!browser) {
      browser = await electronPuppeteer.launch({
        container: document.getElementById('container'),
        preload: 'file://electron-puppeteer/preload/webview.preload.js'
      })
      // do something
    }
    browser.bringToFront()
  }
```

### [Api](./doc/index.html)


## 注意事项
> 所属BrowserWindow的webPreferences.nodeIntegration需要为true，否则无法获取和操作webivew下的iframe  
> 所属BrowserWindow的webPreferences.devtools不能为false，否则launch时传入devtools将无效  
> launch时传入的webPreferences属性都必须在BrowserWindow内配置，否则无法单独生效