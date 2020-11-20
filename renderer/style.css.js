/**
 * @file css to js
 */

export default `
.electron-puppeteer-browser {
	position: absolute;
	width: 100%;
	height: 100%;
	left: 0;
	top: 0;
	z-index: 1;
	background: #fff;
}
.electron-puppeteer-pages {
	position: relative;
	flex: 1;
	height: calc(100% - 46px);
}
.electron-puppeteer-page {
	position: absolute;
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
	display: none;
}
.electron-puppeteer-page webview {
	width: 100%;
	height: 100%;
}
.chrome-tabs {
	-webkit-app-region: drag;
}
.chrome-tab,
.chrome-tabs-button {
	-webkit-app-region: no-drag;
}
`
