const {ipcRenderer, webFrame} = require('electron')
ipcRenderer.setMaxListeners(0)
const routingId = webFrame.routingId
// preload用于和renderer通信的唯一标识
// 也是当前window对象的唯一标识
const UUID =  process.isMainFrame ? '~' : ('uuid_' + Date.now().toString(32) + Math.random().toString(32).substr(1))
const isDevelopment = process.env.NODE_ENV === 'development'
const ipcLog = process.env.ipcLog
isDevelopment && ipcLog && console.log(`%cwebview.preload.js ready, UUID: ${UUID}, url: ${location.href}`, 'font-weight: bold;');

;(
	/* @module init */
	function(parentTask, mainTask, postMessageFn, ipcFn, MousetrapFn, utilFn) {
		var util = {};
		utilFn(util);
	
		var argKeys = util.getArgumentKeys(arguments.callee);
		var argDefines = [].slice.call(arguments);
		var argResults = {
			'util': util
		};
		const exportsSymbol = Symbol('exports')
		function getArgumentsInject(fn, fnName) {
			return util.getArgumentKeys(fn).map(function(key) {
				if (key === 'exports') {
					let exportsArg = {}
					Object.defineProperty(exportsArg, '$$__exports__$$', {
						value: exportsSymbol,
						enumerable: false,
						configurable: false,
						writable: false,
						value: exportsSymbol
					})
					return exportsArg
				}
				let index = argKeys.indexOf(key + 'Fn');
				if (index == -1) {
					return null;
				}
	
				// 循环引用，避免死循环
				if (key === fnName) {
					return null;
				}

				let args = getArgumentsInject(argDefines[index], argKeys[index])
				let exportsArg = args.find(item => item && item["$$__exports__$$"] === exportsSymbol)

				argResults[key] = argResults[key] || argDefines[index].apply(null, args) || exportsArg;
				return argResults[key];
			});
		}
	
		argKeys.forEach(function(argKey, index) {
			if (argKey.slice(-4) == "Task") {
				var task = argDefines[index];
				
				task.apply(null, getArgumentsInject(task, argKey));
			}
		})
	}(
	/* @module parentTask */
	function(util, ipc, postMessage){
		var childFrames = new Map()
		postMessage.on(postMessage.CONST.CHILD_REGISTER, function(evt, childUUID, childRoutingId, childUrl) {
			let childName = ''
			let frameOption
			let frameElements = document.querySelectorAll('iframe')
			frameElements.forEach(frameElm => {
				// 窗口关闭时，evt.source存在为空的情况
				// 判断src和iframe的url可能会存在不准确的情况
				if (frameElm.contentWindow && frameElm.contentWindow === evt.source || frameElm.src === childUrl) {
					var frameId = frameElm.getAttribute('data-electron-frame-id') || util.uniqueId('iframe_id_')
					frameElm.setAttribute('data-electron-frame-id', frameId)
					childName = frameElm.name || frameElm.id
					frameOption = {
						id: frameId,
						parentUUID: UUID,
						UUID: childUUID,
						routingId: childRoutingId,
						name: childName,
						src: frameElm.src,
						url: childUrl
					}
					childFrames.set(frameId, {
						...frameOption,
						frameElement: frameElm
					})
				}
			})

			if (frameOption) {
				ipc.send('childFrame.register', frameOption)
			}

			return [childName, UUID, routingId]
		})
		postMessage.on(postMessage.CONST.CHILD_UNREGISTER, function(evt) {
			let frameElements = document.querySelectorAll('iframe')
			frameElements.forEach(frameElm => {
				if (frameElm.contentWindow && frameElm.contentWindow === evt.source) {
					let frameId = frameElm.getAttribute('data-electron-frame-id') || util.uniqueId('iframe_id_')
					let frameOption = childFrames.get(frameId)
					if (frameOption) {
						childFrames.delete(frameId)
						ipc.send('childFrame.unregister', frameOption)
					}
				}
			})
		})
	},
	/* @module mainTask */
	function(util, ipc, postMessage, Mousetrap) {
		var frameName
		var parentUUID
		var parentRoutingId
		const isMainFrame = process.isMainFrame
		
		if (isMainFrame) {
			init()
		} else {
			postMessage.send(window.parent, postMessage.CONST.CHILD_REGISTER, UUID, routingId, location.href).then(function(evt) {
				frameName = evt.args[0]
				parentUUID = evt.args[1]
				parentRoutingId = evt.args[2]
				init()
			}, function() {
				init()
			})
		}

		function init() {
			// iframe注册
			ipc.send('frame.register', {
				UUID: UUID,
				name: frameName,
				url: location.href,
				parentUUID: parentUUID,
				routingId: routingId,
				parentRoutingId: parentRoutingId,
				isMainFrame: isMainFrame
			})

			util.addEvent(document, 'DOMContentLoaded', function() {
				ipc.send(['frame.domcontentloaded', 'frame.waitForNavigation.domcontentloaded', 'frame.goto.domcontentloaded'], {
					UUID: UUID,
					name: frameName,
					url: location.href,
					routingId: routingId,
					parentUUID: parentUUID,
					parentRoutingId: parentRoutingId,
					isMainFrame: isMainFrame
				})

				// 请求快捷键绑定
				ipc.send("page.shortcuts.call", {}).then(payload => {
					if (Array.isArray(payload)) {
						payload.forEach(item => {
							Mousetrap.bind(item.keys, () => {
								ipc.send("page.shortcuts.trigger", {
									keys: item.keys,
									action: item.action
								})
								if (item.prevent) {
									return false
								}
							})
						})
					}
				})
			})

			util.addEvent(window, 'load', function() {
				ipc.send(['frame.load', 'frame.waitForNavigation.load', 'frame.goto.load'], {
					UUID: UUID,
					name: frameName,
					url: location.href,
					routingId: routingId,
					parentUUID: parentUUID,
					parentRoutingId: parentRoutingId,
					isMainFrame: isMainFrame
				})

				if (isMainFrame) {
					// 发送icon图标
					var iconEL = document.querySelector('link[rel~=icon],link[ref~=shortcut],link[type="image/x-icon"]');
					var favicon = iconEL && iconEL.href || (location.origin + '/favicon.ico');
					ipc.send('page.favicon', {
						favicon: favicon
					});
					ipc.send('page.title', {
						title: document.title
					})
				}
			})
			
			// frame注销
			util.addEvent(window, 'unload', function() {
				postMessage.send(window.parent, postMessage.CONST.CHILD_UNREGISTER)
				ipc.send('frame.unregister', {
					UUID: UUID,
					name: frameName,
					url: location.href,
					routingId: routingId,
					parentUUID: parentUUID,
					parentRoutingId: parentRoutingId,
					isMainFrame: isMainFrame
				})
			});
		}

		var listenerMessages = {
			'frame.waitUntil': function() {
				if (document.readyState == 'complete') {
					return {
						url: location.href,
						states: ['loading', 'domcontentloaded', 'load']
					};
				} else if (document.readyState == 'interactive') {
					return {
						url: location.href,
						states: ['loading', 'domcontentloaded']
					};
				}
	
				return {
					url: location.href,
					states: ['loading']
				};
			},
			'frame.goto': function(param, evt) {
				var url = param && param.url;
				console.log('goto:', url)
				setTimeout(function() {
					// 一定要用location.replace，location.replace跳转到的页面是没有referrer的
					location.replace(url);
				}, 0)
			},
			'frame.title': function(param, evt) {
				return document.title;
			},
			'frame.waitForFunction': function(param, evt) {
				if (!param || !param.pageFunction) {
					return Promise.reject('need pageFunction');
				}
				var timeout = param.options && param.options.timeout || 1e4;
	
				return new Promise(function(resolve, reject) {
					window.addEventListener('unload', () => {
						reject('waitForFunction.unload')
					})
					var now = Date.now();
					var interval = setInterval(function() {
						if (Date.now - now >= timeout) {
							clearInterval(interval);
							reject('waitForFunction.timeout')
						}
	
						try {
							var ret = util.evaluate(param.pageFunction, param.args);
						} catch(e) {
							reject('waitForFunction error:' + e)
						}
	
						if (ret) {
							resolve(true);
						}
					}, param.polling || 30)
				})
			},
			'frame.waitForSelector': function(param, evt) {
				if (!param || !param.selector) {
					return Promise.reject('need selector');
				}
	
				return new Promise(function(resolve, reject) {
					window.addEventListener('unload', () => {
						inject('waitForSelector.unload')
					})

					var options = param.options;
					var timeout = options && options.timeout;
					if (!timeout) {
						timeout = 1e4;
					}
					function check() {
						var dom = document.querySelector(param.selector);
						if (!dom) {
							return
						}
	
						var visibleValid = !options || !options.visible || (dom.style.display != 'none' && dom.style.visibility != 'hidden');
						var hiddenValid = !options || !options.hidden || dom.style.display == 'none' || dom.style.visibility == 'hidden';
	
						if (visibleValid && hiddenValid) {
							clearInterval(timer);
							resolve();
						}
					}
			
					var costTime = 0;
					var timer = setInterval(function() {
						costTime += 50;
						if (timeout != 0 && costTime >= timeout) {
							clearInterval(timer);
							reject('waitForSelector.timeout');
						} else {
							check();
						}
					}, 50);
				})
			},
			'frame.waitForSrcScript': function(param, evt) {
				if (!param || !param.url) {
					return Promise.reject('need url');
				}
				
				var options = param.options;
				var timeout = options && options.timeout;
				if (!timeout) {
					timeout = 1e4;
				}
	
				return watchSrcScript(param.url, timeout);
			},
			'frame.evaluate': function(param, evt) {
				if (!param || !param.pageFunction) {
					return Promise.reject('need pageFunction');
				}
				
				return util.evaluate(param.pageFunction, param.args);
			},
			'frame.addScriptTag': function(param, evt) {
				var id = util.uniqueId("script_")
				if (param.url) {
					if (param.waitLoad) {
						return new Promise(function(resolve, reject) {
							util.loadScript(param.url, id, param.type, function() {
								resolve('#' + id);
							}, reject)
						})
					} else {
						util.loadScript(param.url, id, param.type)
						return '#' + id
					}
				} else if (param.content) {
					util.addScript(param.content, id, param.type)
					return '#' + id
				}

				return Promise.reject("need url or content")
			},
			'frame.addStyleTag': function(param, evt) {
				var id = util.uniqueId("style_")
				if (param.url) {
					util.loadLinkStyle(param.url, id)
				} else if (param.content) {
					util.addStyle(param.content, id)
				} else {
					return Promise.reject("need url or content")
				}
				
				return '#' + id;
			},
			'elementHandle.$$': function(param, evt) {
				if (!param.selector) {
					return Promise.reject('need selector');
				}
	
				var baseElement = util.getSelectorElement(param.baseSelector);
				
				if (baseElement) {
					return baseElement.querySelectorAll(param.selector).length;
				}
	
				return 0;
			},
			'elementHandle.$eval': function(param, evt) {
				if (!param || !param.pageFunction || !param.selector) {
					return Promise.reject('need pageFunction and selector');
				}
	
				var elm = util.getSelectorElement(param.baseSelector);
				if (!elm) {
					return
				}
	
				var args = param.args || [];
				args.unshift(elm.querySelector(param.selector));
	
				return util.evaluate(param.pageFunction, args);
			},
			'elementHandle.$$eval': function(param, evt) {
				if (!param || !param.pageFunction || !param.selector) {
					return Promise.reject('need pageFunction and selector');
				}
	
				var elm = util.getSelectorElement(param.baseSelector);
				if (!elm) {
					return
				}
	
				var args = param.args || [];
				args.unshift(elm.querySelectorAll(param.selector));
	
				return util.evaluate(param.pageFunction, args);
			},
			'elementHandle.getBoundingClientRect': function(param, evt) {
				if (!param || !param.selector) {
					return Promise.reject('need selector');
				}
	
				var elm = util.getSelectorElement(param.selector);
				if (!elm) {
					return Promise.reject('not find element: ' + param.selector)
				}
				
				return elm.getBoundingClientRect()
			},
			'elementHandle.click': function(param, evt) {
				if (!param || !param.selector) {
					return Promise.reject('need selector');
				}
	
				var elm = util.getSelectorElement(param.selector);
				if (!elm) {
					return Promise.reject('not find element: ' + param.selector)
				}
	
				elm.scrollIntoView({block: 'center'});
				if (typeof elm.click === 'function') {
					elm.click();
				} else {
					elm.dispatchEvent(new MouseEvent('click', {bubbles: true}));
				}
				return true;
			},
			'elementHandle.focus': function(param, evt) {
				if (!param || !param.selector) {
					return Promise.reject('need selector');
				}
	
				var elm = util.getSelectorElement(param.selector);
				if (!elm) {
					return Promise.reject('not find element: ' + param.selector)
				}
	
				elm.focus();
				// elm.dispatchEvent(new window.FocusEvent('focusin', {bubbles: true}));
				// elm.dispatchEvent(new window.CustomEvent('td-transfer-focusin', {bubbles: true}));
				// elm.dispatchEvent(new window.FocusEvent('focus'));
	
				// // 其它元素聚焦时，触发当前元素的blur
				// document.addEventListener('focusin', function(evt) {
				// 	document.removeEventListener('focusin', arguments.callee);
				// 	if (evt.target !== elm) {
				// 		elm.dispatchEvent(new window.FocusEvent('blur'));
				// 	}
				// }, false);
				return true;
			},
			'elementHandle.blur': function(param, evt) {
				if (!param || !param.selector) {
					return Promise.reject('need selector');
				}
	
				var elm = util.getSelectorElement(param.selector);
				if (!elm) {
					return Promise.reject('not find element: ' + param.selector)
				}
	
				elm.blur();
				// elm.dispatchEvent(new window.FocusEvent('focusout'));
				// elm.dispatchEvent(new window.FocusEvent('blur'));
				return true;
			},
			'elementHandle.check': function(param, evt) {
				if (!param || !param.selector) {
					return Promise.reject('need selector');
				}
	
				var elm = util.getSelectorElement(param.selector);
				if (!elm) {
					return Promise.reject('not find element: ' + param.selector)
				}
	
				elm.checked = true;
				elm.dispatchEvent(new Event('change', {bubbles: true}));
				return true;
			},
			'elementHandle.uncheck': function(param, evt) {
				if (!param || !param.selector) {
					return Promise.reject('need selector');
				}
	
				var elm = util.getSelectorElement(param.selector);
				if (!elm) {
					return Promise.reject('not find element: ' + param.selector)
				}
	
				elm.checked = false;
				elm.dispatchEvent(new Event('change', {bubbles: true}));
				return true;
			},
			'elementHandle.getAttributes': function(param, evt) {
				if (!param || !param.selector) {
					return Promise.reject('need selector');
				}
	
				var elm = util.getSelectorElement(param.selector);
				if (!elm) {
					return;
				}
	
				var attributes = elm.attributes;
				var properties = {};
				for (var i = 0; i < attributes.length; i++) {
					properties[attributes[i].nodeName] = attributes[i].nodeValue;
				}
	
				return properties;
			},
			'elementHandle.getAttribute': function(param, evt) {
				if (!param || !param.selector || !param.attrName) {
					return Promise.reject('need selector and attrName');
				}
	
				var elm = util.getSelectorElement(param.selector);
				if (!elm) {
					return;
				}
	
				return elm.getAttribute(param.attrName);
			},
			'elementHandle.hover': function(param, evt) {
				if (!param || !param.selector) {
					return Promise.reject('need selector');
				}
	
				var elm = util.getSelectorElement(param.selector);
				if (!elm) {
					return Promise.reject('not find element: '  + param.selector)
				}
	
				return util.triggerMouseEvent(elm, 'mouseover');
			},
			'elementHandle.press': function(param, evt) {
				if (!param || !param.selector || !param.keyCode) {
					return Promise.reject('need selector && keyCode');
				}
	
				// console.log('elementHandle.press: ', param.selector);
				var elm = util.getSelectorElement(param.selector);
				if (!elm) {
					return Promise.reject('not find element: ' + param.selector);
				}
	
				var tag = elm.tagName.toLowerCase();
	
				if (tag !== 'input' && tag !== 'textarea') {
					return Promise.reject('element found is neither input nor textarea')
				}
	
				elm.scrollIntoView({block: 'center'});
				return new Promise(function(resolve) {
					function setValue(elm, value) {
						// 调用descriptor主要为了解决react的onChange不触发的问题
						var valueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
						if (valueDescriptor && valueDescriptor.set) {
							valueDescriptor.set.call(elm, value);
						} else {
							elm.value = value;
						}
					}
	
					util.triggerKeyboardEvent(elm, param.keyCode, 'keydown');
					util.triggerKeyboardEvent(elm, param.keyCode, 'keypress');
					setTimeout(function() {
						var inputType, inputData;
						if (param.keyCode == 8) {
							inputType = "insertText"; 
							inputData = elm.value.slice(-1);
	
							setValue(elm, elm.value.slice(0, -1));
						} else if (param.keyCode != 13) {
							inputData = param.text;
							inputType = "deleteContentBackward";
	
							setValue(elm, elm.value + param.text);
						}
	
						// 触发input事件
						if (inputType && window.InputEvent) {
							elm.dispatchEvent(new InputEvent('input', {
								bubbles: true,
								inputType: inputType,
								data: inputData
							}));
	
						}
	
						// 在blur时触发change事件
						if (!elm._$$$_td_transfer_blur_binded) {
							elm._$$$_td_transfer_blur_binded = 1;
							elm.addEventListener('blur', function() {
								elm._$$$_td_transfer_blur_binded = 0;
								elm.removeEventListener('blur', arguments.callee);
								
								elm.dispatchEvent(new Event('change', {bubbles: true}));
							}, false);
						}
						util.triggerKeyboardEvent(elm, param.keyCode, 'keyup');
						resolve();
					}, 0)
				})
			},
			'frame.localStorageKeys': function() {
				return Object.keys(localStorage)
			},
			'frame.localStorageGet': function({key}) {
				return localStorage.getItem(key)
			},
			'frame.localStorageSet': function({key, value}) {
				return localStorage.setItem(key, value)
			},
			'frame.localStorageRemove': function({key}) {
				return localStorage.removeItem(key)
			},
		}
		
		Object.keys(listenerMessages).forEach(function(msg) {
			var listener = listenerMessages[msg]
			ipc.on(msg, listener)
		});
	},
	/* @module postMessageFn */
	function(util) {
		const MESSAGE_PREFIX = 'electron-puppeteer.'
		return {
			// 消息解码
			decode: function(evt) {
				if (typeof evt.data === 'string') {
					var arr = evt.data.split('/')

					arr = arr.map(item => decodeURIComponent(item))

					if (typeof arr[0] === 'string' && arr[0].indexOf(MESSAGE_PREFIX) === 0) {
						return {
							name: arr.shift().slice(MESSAGE_PREFIX.length),
							ack: arr.shift(),
							args: arr
						}
					}
				}

				return {
					name: '',
					ack: '',
					args: []
				}
			},
			// 消息编码
			encode: function(name, ack, ...args) {
				name = MESSAGE_PREFIX + name
				return [name, ack].concat(args).map(arg => encodeURIComponent(arg)).join('/')
			},
			// 生成ack名称
			ack: function(name) {
				return util.uniqueId(name + '.ack.')
			},
			/**
			 * 发送消息
			 * @param {Window} target 目标窗口
			 * @param {string} name 消息名
			 * @param {...string} args 参数，只支持字符串类型，object类型请自行JSON.stringify
			 * @return {Promise<MessageEvent && {name:string, args:[]string}>} 返回promise，等待消息回复内容
			 */
			send: function(target, name, ...args) {
				const ack = this.ack(name)

				return new Promise((resolve, reject) => {
					const onAck = (evt) => {
						if (typeof evt.data !== 'string') {
							return
						}
		
						const msg = this.decode(evt)
						if (msg.name === ack) {
							window.removeEventListener('message', onAck, false)
							evt.name = msg.name
							evt.args = msg.args
							window.clearTimeout(timeout)
							resolve(evt)
						}
					}

					var timeout = window.setTimeout(() => {
						window.removeEventListener('message', onAck, false)
						reject("postMessage.timeout")
					}, 5e3)
					
					window.addEventListener('message', onAck, false)
					target.postMessage(this.encode(name, ack, ...args), '*')
				})
			},
			/**
			 * @typedef {Function} postMessageListener
			 * @param {MessageEvent && {name:string, args:[]string}} evt 消息对象
			 * @param {...args} string 消息参数
			 */
			/**
			 * 监听消息
			 * @param {string} name 消息名
			 * @param {postMessageListener} callback 响应函数
			 * @param {boolean} once 只响应一次消息
			 * @return {Function} 返回off函数
			 * 
			 */
			on: function(name, callback, once) {
				const onMessage = (evt) => {
					if (typeof evt.data !== 'string') {
						return
					}
	
					const msg = this.decode(evt)
	
					if (msg.name && msg.name === name) {
						if (once) {
							window.removeEventListener('message', onMessage, false)
						}

						Object.assign(evt, msg)
						var ret = callback.apply(this, [evt].concat(msg.args))

						if (msg.ack) {
							if (ret && ret.then) {
								ret.then(function(value) {
									if (evt.source) {
										evt.source.postMessage(this.encode(msg.ack, '', ...[].concat(value || [])), '*')
									}
								})
							} else if (evt.source) {
								evt.source.postMessage(this.encode(msg.ack, '', ...[].concat(ret || [])), '*')
							}
						} 
					}
				}
				window.addEventListener('message', onMessage, false)

				return function off() {
					window.removeEventListener('message', onMessage, false)
				}
			},
			/**
			 * 单次监听消息
			 * @param {string} name 消息名
			 * @param {postMessageListener} callback 响应函数
			 * @return {undefined}
			 */
			once: function(name, callback) {
				this.on(name, callback, true)
			},
			CONST: {
				// iframe注册消息
				CHILD_REGISTER: 'child.register',
				// iframe注销消息
				CHILD_UNREGISTER: 'child.unregister'
			}
		}
	},
	/* @module ipcFn */
	function(util, exports) {
		// preload to renderer
		const SEND_NAME = 'electron-puppeteer_p2r'
		// renderer to preload
		const RECEIVE_NAME = 'electron-puppeteer_r2p'
		// ack prefix
		const ACK_PREFIX = 'ack_p2r_'
		// default options
		let _options = {
			timeout: 1e4
		}
		// listeners stack
		let _listeners = []

		/**
	 * @typedef {Object} IpcEvent
	 * @property {string} name 消息名
	 * @property {string} ack 回执消息名
	 * @property {IpcEvent} originalEvent 原生事件
	 */
	/**
	 * @typedef {Function} IpcListener
	 * @param {IpcEvent} evt 消息对象
	 * @param {Object} payload 消息参数
	 */

		ipcRenderer.on(RECEIVE_NAME, function(originalEvent, evt) {
			evt.originalEvent = originalEvent

			if (evt.UUID === UUID || evt.UUID === '*') {
				if (evt.isAck) {
					isDevelopment && ipcLog && console.log('%cipc ack', 'font-weight:bold;color:green;', `name: ${evt.name},`, `UUID: ${evt.UUID}`, `payload: ${JSON.stringify(evt.payload)}`)
				} else {
					isDevelopment && ipcLog && console.log('%cipc receive', 'font-weight:bold;color:darkCyan;', `name: ${evt.name},`, `ack: ${evt.ack},`, `UUID: ${evt.UUID},`, `payload: ${JSON.stringify(evt.payload)}`)
				}
			}

			let results = []
			for (let i = 0; i < _listeners.length; i++) {
				let item = _listeners[i]
				if ((evt.UUID === '*' || UUID === evt.UUID) && item.name === evt.name && !!item.isAck === !!evt.isAck) {
					let once = item.isAck && item.once
					if (once) {
						_listeners.splice(i--, 1)
					}
					results.push(item.listener.call(this, evt.payload, evt))
					break
				}
			}

			// reply
			// 没有ack则认为不需要回复
			if (!evt.isAck && evt.ack) {
				
				Promise.all(results).then(results => {
					let result = results.shift()
					isDevelopment && ipcLog && console.log('%cipc reply', 'font-weight:bold;color:#c59519', `name: ${evt.ack},`,  `result: ${JSON.stringify(result)}`)
					ipcRenderer.sendToHost(SEND_NAME, {
						UUID: UUID,
						routingId: routingId,
						name: evt.ack,
						ack: '',
						isAck: true,
						isMainFrame: process.isMainFrame,
						payload: result
					})
				})
			}
		})

		// 生成ack_name
		function _generatorAckName(name) {
			return util.uniqueId(ACK_PREFIX + name + '_')
		}

		/**
		 * 配置
		 */
		exports.setOptions = function(options) {
			_options = options
			return this
		}

		/**
		 * 发送消息给webview
		 * @param {string|string[]} name 消息名, 支持合并发送payload相同的消息
		 * @param {Object} payload 传输数据
	 	 * @param {number} timeout 等待回复时间
		 * 
		 * @return {Promise<IpcEvent>} 返回promise，等待消息回复内容
		 */
		exports.send = function(name, payload, timeout) {
			if (Array.isArray(name)) {
				return Promise.all(name.map(item => this.send(item, payload, timeout)))
			}

			let ack = _generatorAckName(name)
			timeout = timeout || _options.timeout || 1e4

			return new Promise((resolve, reject) => {
				// 收到回执信息，触发回调
				let onAck = (result) => {
					window.clearTimeout(timer)
					resolve(result)
				}
				// 放入监听队列
				_listeners.push({
					name: ack,
					listener: onAck, 
					once: true,
					isAck: true,
				})
				// 超时判断
				let timer = window.setTimeout(() => {
					this.off(ack, onAck)
					reject('preload.ipc.timeout')
				}, timeout)
				
				isDevelopment && ipcLog && console.log('%cipc send', 'font-weight:bold;color:#00f', `name: ${name},`, `ack: ${ack},`, `payload: ${JSON.stringify(payload)}`)

				// 发送消息
				ipcRenderer.sendToHost(SEND_NAME, {
					UUID: UUID,
					routingId: routingId,
					name: name,
					ack: ack,
					isAck: false,
					isMainFrame: process.isMainFrame,
					payload: payload
				})
			}).catch(err => {
				if (err === 'preload.ipc.timeout') {
					isDevelopment && ipcLog && console.log('%cipc timeout', 'font-weight:bold;color:#f00', `name: ${name},`, `ack: ${ack},`, `payload: ${JSON.stringify(payload)}`)
				} else {
					console.error('ipc send error:', err)
				}
			})
		}
		/**
		 * 监听webview发送的消息
		 * @param {string} name 消息名
		 * @param {IpcListener} listener 响应函数
		 * 
		 * @return {Ipc} this
		 * 
		 */
		exports.on = function(name, listener) {
			_listeners.push({
				name,
				listener,
				once: false,
				isAck: false,
			})
			return this
		}
		/**
		 * 单次监听webview消息
		 * @param {string} name 消息名
		 * @param {IpcListener} listener 响应函数
		 * 
		 * @return {Ipc} this
		 * 
		 */
		exports.once = function(name, listener) {
			_listeners.push({
				name,
				listener,
				once: true,
				isAck: false,
			})
			return this
		}
		/**
		 * 取消监听
		 * @param {string} name 消息名
		 * @param {?IpcListener} listener 响应函数
		 * @return {Ipc} this
		 */
		exports.off = function(name, listener) {
			_listeners = _listeners.filter(item => {
				if (item.name === name && (!listener || item.listener === listener)) {
					return false
				}
				return true
			})
			return this
		}
	},
	/* @module MousetrapFn */ 
	function() {
		/* mousetrap v1.6.5 craig.is/killing/mice */
		const Mousetrap = (function(q,u,c){function v(a,b,g){a.addEventListener?a.addEventListener(b,g,!1):a.attachEvent("on"+b,g)}function z(a){if("keypress"==a.type){var b=String.fromCharCode(a.which);a.shiftKey||(b=b.toLowerCase());return b}return n[a.which]?n[a.which]:r[a.which]?r[a.which]:String.fromCharCode(a.which).toLowerCase()}function F(a){var b=[];a.shiftKey&&b.push("shift");a.altKey&&b.push("alt");a.ctrlKey&&b.push("ctrl");a.metaKey&&b.push("meta");return b}function w(a){return"shift"==a||"ctrl"==a||"alt"==a||
		"meta"==a}function A(a,b){var g,d=[];var e=a;"+"===e?e=["+"]:(e=e.replace(/\+{2}/g,"+plus"),e=e.split("+"));for(g=0;g<e.length;++g){var m=e[g];B[m]&&(m=B[m]);b&&"keypress"!=b&&C[m]&&(m=C[m],d.push("shift"));w(m)&&d.push(m)}e=m;g=b;if(!g){if(!p){p={};for(var c in n)95<c&&112>c||n.hasOwnProperty(c)&&(p[n[c]]=c)}g=p[e]?"keydown":"keypress"}"keypress"==g&&d.length&&(g="keydown");return{key:m,modifiers:d,action:g}}function D(a,b){return null===a||a===u?!1:a===b?!0:D(a.parentNode,b)}function d(a){function b(a){a=
		a||{};var b=!1,l;for(l in p)a[l]?b=!0:p[l]=0;b||(x=!1)}function g(a,b,t,f,g,d){var l,E=[],h=t.type;if(!k._callbacks[a])return[];"keyup"==h&&w(a)&&(b=[a]);for(l=0;l<k._callbacks[a].length;++l){var c=k._callbacks[a][l];if((f||!c.seq||p[c.seq]==c.level)&&h==c.action){var e;(e="keypress"==h&&!t.metaKey&&!t.ctrlKey)||(e=c.modifiers,e=b.sort().join(",")===e.sort().join(","));e&&(e=f&&c.seq==f&&c.level==d,(!f&&c.combo==g||e)&&k._callbacks[a].splice(l,1),E.push(c))}}return E}function c(a,b,c,f){k.stopCallback(b,
		b.target||b.srcElement,c,f)||!1!==a(b,c)||(b.preventDefault?b.preventDefault():b.returnValue=!1,b.stopPropagation?b.stopPropagation():b.cancelBubble=!0)}function e(a){"number"!==typeof a.which&&(a.which=a.keyCode);var b=z(a);b&&("keyup"==a.type&&y===b?y=!1:k.handleKey(b,F(a),a))}function m(a,g,t,f){function h(c){return function(){x=c;++p[a];clearTimeout(q);q=setTimeout(b,1E3)}}function l(g){c(t,g,a);"keyup"!==f&&(y=z(g));setTimeout(b,10)}for(var d=p[a]=0;d<g.length;++d){var e=d+1===g.length?l:h(f||
		A(g[d+1]).action);n(g[d],e,f,a,d)}}function n(a,b,c,f,d){k._directMap[a+":"+c]=b;a=a.replace(/\s+/g," ");var e=a.split(" ");1<e.length?m(a,e,b,c):(c=A(a,c),k._callbacks[c.key]=k._callbacks[c.key]||[],g(c.key,c.modifiers,{type:c.action},f,a,d),k._callbacks[c.key][f?"unshift":"push"]({callback:b,modifiers:c.modifiers,action:c.action,seq:f,level:d,combo:a}))}var k=this;a=a||u;if(!(k instanceof d))return new d(a);k.target=a;k._callbacks={};k._directMap={};var p={},q,y=!1,r=!1,x=!1;k._handleKey=function(a,
		d,e){var f=g(a,d,e),h;d={};var k=0,l=!1;for(h=0;h<f.length;++h)f[h].seq&&(k=Math.max(k,f[h].level));for(h=0;h<f.length;++h)f[h].seq?f[h].level==k&&(l=!0,d[f[h].seq]=1,c(f[h].callback,e,f[h].combo,f[h].seq)):l||c(f[h].callback,e,f[h].combo);f="keypress"==e.type&&r;e.type!=x||w(a)||f||b(d);r=l&&"keydown"==e.type};k._bindMultiple=function(a,b,c){for(var d=0;d<a.length;++d)n(a[d],b,c)};v(a,"keypress",e);v(a,"keydown",e);v(a,"keyup",e)}if(q){var n={8:"backspace",9:"tab",13:"enter",16:"shift",17:"ctrl",
		18:"alt",20:"capslock",27:"esc",32:"space",33:"pageup",34:"pagedown",35:"end",36:"home",37:"left",38:"up",39:"right",40:"down",45:"ins",46:"del",91:"meta",93:"meta",224:"meta"},r={106:"*",107:"+",109:"-",110:".",111:"/",186:";",187:"=",188:",",189:"-",190:".",191:"/",192:"`",219:"[",220:"\\",221:"]",222:"'"},C={"~":"`","!":"1","@":"2","#":"3",$:"4","%":"5","^":"6","&":"7","*":"8","(":"9",")":"0",_:"-","+":"=",":":";",'"':"'","<":",",">":".","?":"/","|":"\\"},B={option:"alt",command:"meta","return":"enter",
		escape:"esc",plus:"+",mod:/Mac|iPod|iPhone|iPad/.test(navigator.platform)?"meta":"ctrl"},p;for(c=1;20>c;++c)n[111+c]="f"+c;for(c=0;9>=c;++c)n[c+96]=c.toString();d.prototype.bind=function(a,b,c){a=a instanceof Array?a:[a];this._bindMultiple.call(this,a,b,c);return this};d.prototype.unbind=function(a,b){return this.bind.call(this,a,function(){},b)};d.prototype.trigger=function(a,b){if(this._directMap[a+":"+b])this._directMap[a+":"+b]({},a);return this};d.prototype.reset=function(){this._callbacks={};
		this._directMap={};return this};d.prototype.stopCallback=function(a,b){if(-1<(" "+b.className+" ").indexOf(" mousetrap ")||D(b,this.target))return!1;if("composedPath"in a&&"function"===typeof a.composedPath){var c=a.composedPath()[0];c!==a.target&&(b=c)}return"INPUT"==b.tagName||"SELECT"==b.tagName||"TEXTAREA"==b.tagName||b.isContentEditable};d.prototype.handleKey=function(){return this._handleKey.apply(this,arguments)};d.addKeycodes=function(a){for(var b in a)a.hasOwnProperty(b)&&(n[b]=a[b]);p=null};
		d.init=function(){var a=d(u),b;for(b in a)"_"!==b.charAt(0)&&(d[b]=function(b){return function(){return a[b].apply(a,arguments)}}(b))};d.init();return d}})("undefined"!==typeof window?window:null,"undefined"!==typeof window?document:null);

		return Mousetrap
	},
	/* @module utilFn */
	function(exports) {
	
		// eval且作用域绑定在window
		function globalEval(content) {
			// if (debug) {
			// 	console.log("eval content: \n", content);
			// }
					/* eslint no-eval: 0 */
			var e = eval;
			return e(content);
		}
		
		function getArgumentKeys(fn) {
			var matches = fn.toString().match(/^function\s*\(([^)]+)\)/)
			if (matches && matches[1]) {
				return matches[1].split(',').map(function(item) {
					return item.trim();
				});
			}
	
			return [];
		}
	
		function evaluate(expression, args) {
			try {
				var method = globalEval("(" + expression + ")");
			} catch(err) {
				isDevelopment && ipcLog && console.error(`evaluate error, expression: ${expression}, args: ${args}, err: ${err}`)
				return Promise.reject(err)
			}

			var argKeys = getArgumentKeys(method);
	
			var utilIndex = argKeys.indexOf('util');
			if (utilIndex > -1 && args.length < utilIndex + 1) {
				args[utilIndex] = exports;
			}
	
			return method.apply(null, args);
		}
	
		function isFunction(a) {
			return "function" == typeof a
		}
	
		function isArray(a) {
			return "[object Array]" == ({}).toString.call(Object(a));
		}
	
		function isObject(a) {
			return "[object Object]" == ({}).toString.call(Object(a));
		}
	
		function isString(a) {
			return void 0 != a && -1 < (a.constructor + "").indexOf("String")
		}
	
		// DOM事件绑定
		function addEvent(elm, type, handle, capture) {
			elm.addEventListener ? elm.addEventListener(type, handle, !!capture) : elm.attachEvent && elm.attachEvent("on" + type, handle)
		}
	
		// 解除DOM事件绑定
		function removeEvent(elm, type, handle) {
			elm.removeEventListener ? elm.removeEventListener(type, handle, !1) : elm.detachEvent && elm.detachEvent("on" + type, handle)
		}
	
		/**
		 * 获取随机整数
		 * @return {Int}
		 */
		function random() {
			return Math.round(Math.random() * 2147483647);
		}
	
		/**
		 * 生成随机id
		 * @param  {String} prefix    随机id前缀
		 * @return {String}
		 */
		function uniqueId(prefix) {
			return (
				(prefix || "") +
				Math.random().toString(32).substr(1) +
				Date.now().toString(32)
			);
		}
	
		function hash(str) {
			var b = 1,
				c = 0,
				d;
			if (str) {
				for (b = 0, d = str.length - 1; 0 <= d; d--) {
					c = str.charCodeAt(d),
					b = (b << 6 & 268435455) + c + (c << 14),
					c = b & 266338304,
					b = 0 !== c ? b ^ c >> 21 : b;
				}
			}
			return b
		}

		function loadLinkStyle(href, id) {
			var link = document.createElement("link");
			link.rel = "stylesheet"
			link.type = "text/css";
			link.href = href;
			link.id = id;
			var d = document.getElementsByTagName("link")[0];
			if (d) {
				d.parentNode.insertBefore(link, d);
			} else {
				document.documentElement.appendChild(link)
			}
			return link;
		}

		function addStyle(content, id) {
			var style = document.createElement("style");
			style.type = "text/css";
			style.id = id;
			if (style.styleSheet) {
				style.styleSheet.cssText = content;
			} else {
				var cssText = doc.createTextNode(content);
				style.appendChild(cssText);
			}
			var d = document.getElementsByTagName("head")[0];
			if (d) {
				d.appendChild(style);
			} else {
				document.documentElement.appendChild(style)
			}
			return style;
		}
	
		/**
		 * 动态加载远程js
		 * @param  {String}   src     js文件路径
		 * @param  {String}   id      节点id
		 * @param  {String}   [type]    type属性
		 * @param  {Function} success 成功回调
		 * @param  {Function} error   失败回调
		 */
		function loadScript(src, id, type, success, error) {
			if (src) {
				var c = document.createElement("script");
				c.type = type || "text/javascript";
				c.async = !0;
				c.src = src;
				c.id = id;
				if (success) {
					if (c.addEventListener) {
						c.onload = success;
					} else {
						c.onreadystatechange = function() {
							if (c.readyState in {
								loaded: 1,
								complete: 1
							}) {
								c.onreadystatechange = null;
								success();
							}
						}
					}
				}
				if (error) {
					c.onerror = error;
				}
				var d = document.getElementsByTagName("script")[0];
				if (d) {
					d.parentNode.insertBefore(c, d);
				} else {
					document.documentElement.appendChild(c)
				}
				return c;
			}
		}

		/**
		 * 添加script标签
		 * @param {String} content script内容
		 * @param {String} id id
		 * @param {String} [type] type属性
		 * 
		 * @return {Element} 返回新建的节点
		 */
		function addScript(content, id, type) {
			var scriptTag = document.createElement('script');
			scriptTag.id = id
			scriptTag.text = content
			scriptTag.type = type || "text/javascript"
			var existingTag = document.getElementsByTagName("script")[0];
			existingTag.parentNode.insertBefore(scriptTag, existingTag);

			return scriptTag
		}
	
		/**
		 * url参数格式化
		 * @param  {Object} param 要发送的参数
		 * @return {String}       合并后的字符串
		 */
		function serializeParam(param) {
			var res = [];
			var enc = encodeURIComponent;
			for (var name in param){
				if (param.hasOwnProperty(name) && param[name] != null){
					res.push(enc(name) + '=' + enc(param[name]));
				}
			}
			return res.join('&');
		}
	
		/**
		 * url参数拼接
		 * @param  {String}        url   请求url
		 * @param  {String|Object} param 请求参数
		 * @return {String}              拼接后的url
		 */
		function appendQueryString(url, param) {
			url = url || "";
			if (isObject(param)) {
				param = serializeParam(param);
			}
			if (param) {
				url += (url.indexOf('?') == -1) ? '?' : '&';
				url += param;
			}
			return url;
		}
	
		/**
		 * jsonp形式发送数据
		 * @param  {String}   url       服务器地址
		 * @param  {Object}   param     参数对象
		 * @param  {Function} callback  <可选>回调
		 * @return {Boolean}            返回发送成功状态
		 */
		function jsonp(url, param, callback) {
			var responseContainer;
			var id = uniqueId('__td_transfer_jsonp_script_id');
			var callbackName =  uniqueId('__td_transfer_jsonp_cb');
			var complete = function(msg) {
				if (isFunction(callback)) {
					callback(msg, responseContainer);
				}
				var script = document.getElementById(id);
				if (script && script.parentNode) {
					script.parentNode.removeChild(script);
				}
				window[callbackName] = originFunc;
			}
	
			// 存储旧的名称
			var originFunc = window[callbackName];
			window[callbackName] = function() {
				// 存储参数
				responseContainer = arguments[0];
			}
	
			url = appendQueryString(url, param);
			url = appendQueryString(url, 'callback=' + callbackName);
	
			loadScript(url, id, null, function() {
				complete();
			}, function(message) {
				complete(message || "jsonp error");
			});
		}
	
		function getUrlHash(url) {
			var arr = url.split('#');
			arr[0] = "";
			return arr.join('#');
		}
	
		function getUrlSearch(url) {
			url = url.split('#').shift();
			var arr = url.split('?');
			arr[0] = "";
			return arr.join('?');
		}
	
		/**
		 * cookie操作函数
		 * 只传入名称时为获取
		 * 存储时参数书写：cookie( name, value, expires, path, domain, secure );
		 */
		function cookie(n) {
			var d = new Date(),
				a = arguments,
				l = a.length;
			if (l > 1) {
				var e = a[2] || 0,
					p = a[3] || "/",
					dm = a[4] || 0,
					se = a[5] || 0;
				if (e) {
					d.setTime(d.getTime() + (e * 1E3));
				}
				document.cookie = n + "=" + escape(a[1]) + (e ? ("; expires=" + d.toGMTString()) : "") + ("; path=" + p) + (dm && dm != "none" ? ("; domain=" + dm) : "") + (se ? "; secure" : "");
				return a[1];
			} else {
				var v = document.cookie.match("(?:^|;)\\s*" + n + "=([^;]*)");
				return v ? unescape(v[1]) : '';
			}
		}
	
		// 解析fake-puppeteer传入的selector
		function getSelectorElement(selector) {
			if (!selector || !selector.length) {
				return document;
			}
	
			var currentSelector;
			var currentElement = document;
			selector = selector.slice(0);
			while(currentElement != null && selector.length) {
				var currentSelector = selector.shift();
				if (currentSelector == 'document') {
					currentElement = document;
				} else if (isArray(currentSelector)) {
					// 数组是调用querySelectorAll，然后再取索引
					// [selector, index]
					currentElement = currentElement.querySelectorAll(currentSelector[0])[currentSelector[1]];
				} else {
					currentElement = currentElement.querySelector(currentSelector);
				}
			}
	
			return currentElement
		}
	
		function triggerMouseEvent(elem, evtType, screenXArg, screenYArg, clientXArg, clientYArg) {
			var evtObj = document.createEvent("MouseEvent");
			evtObj.initMouseEvent(evtType, true, true, window, 0, screenXArg, screenYArg, clientXArg, clientYArg, 0, 0, 0, 0, 0, null);
			elem.dispatchEvent(evtObj);
		} 
	
		function triggerKeyboardEvent(elem, keyCode, evtType) {
			var evtObj = document.createEvent('KeyboardEvent');  
			Object.defineProperty(evtObj, 'keyCode', {  
				get: function() {return this.keyCodeVal; }  
			});       
			Object.defineProperty(evtObj, 'which', {  
				get: function() { return this.keyCodeVal; }  
			});  
			evtObj.initUIEvent(evtType, true, true, window, 1);  
			evtObj.keyCodeVal = keyCode; 
			elem.dispatchEvent(evtObj);
		}
	
		var lastFoundInternalKey = null;
		function getReactInternal(node) {
			if (!node) {
				return null;
			}
			if (lastFoundInternalKey !== null && node.hasOwnProperty(lastFoundInternalKey)) {
				return node[lastFoundInternalKey];
			}
	
			var internalKey = Object.keys(node).find(
				key => key.indexOf('__reactInternalInstance') === 0,
			);
			if (internalKey) {
				lastFoundInternalKey = internalKey;
				return node[lastFoundInternalKey];
			}
	
			return null;
		}
	
		function fetch(url, options) {
			return new Promise(function (resolve, reject) {
				var xhr = new XMLHttpRequest();
				xhr.open(options && options.method || 'GET', url);
				if (options && options.headers) {
					for (var key in options.headers) {
						xhr.setRequestHeader(key, options.headers[key]);
					}
				}
	
				xhr.onload = function() {
					resolve({
						url: url,
						ok: Math.floor(this.status / 100) === 2,
						status: this.status,
						statusText: this.statusText,
						body: this.responseText,
						json: function() {
							try {
	
								var data = JSON.parse(xhr.responseText);
								return Promise.resolve(data);
							} catch (e) {
								return Promise.reject(e)
							}
						},
						text: function() {
							return Promise.resolve(xhr.responseText);
						}
					})
				}
				xhr.onerror = function(err) {
					reject(err)
				}
				xhr.ontimeout = function() {
					reject('fetch.timeout');
				}
	
				if (options && options.method === 'POST') {
					xhr.send(options.body)
				} else {
					xhr.send()
				}
			})
		}
	
		Object.assign(exports, {
			globalEval: globalEval,
			getArgumentKeys: getArgumentKeys,
			evaluate: evaluate,
			isFunction: isFunction,
			isArray: isArray,
			isObject: isObject,
			isString: isString,
			addEvent: addEvent,
			removeEvent: removeEvent,
			random: random, 
			uniqueId: uniqueId, 
			hash: hash,
			loadLinkStyle: loadLinkStyle,
			addStyle: addStyle,
			loadScript: loadScript,
			addScript: addScript,
			appendQueryString: appendQueryString,
			serializeParam: serializeParam,
			jsonp: jsonp,
			getUrlHash: getUrlHash,
			getUrlSearch: getUrlSearch,
			cookie: cookie,
			triggerMouseEvent: triggerMouseEvent,
			triggerKeyboardEvent: triggerKeyboardEvent,
			getSelectorElement: getSelectorElement,
			getReactInternal: getReactInternal,
			fetch: fetch,
			console: (function name() {
				var console = {};
				["debug", "info", "warn", "error", "log"].forEach(function(key) {
					console[key] = window.console[key].bind(window.console);
				})
				return console;
			})()
		})
		window._td_transfer_inject_util_ = exports;
	}
	)
)