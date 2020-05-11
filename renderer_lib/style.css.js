"use strict";

Object.defineProperty(exports, "__esModule", {
	value: true
});
/**
 * @file css to js
 */

exports.default = `
.electron-puppeteer-browser {
  height: 100%;
}
.electron-puppeteer-pages {
	position: relative;
	flex: 1;
	height: calc(100% - 46px);
}
.electron-puppeteer-pages webview {
	position: absolute;
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
	display: none;
}
`;