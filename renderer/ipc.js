/**
 * @file ipc通信类
 */
const {remote} = require("electron")
import util from "./util.js"

const isDevelopment = process.env.NODE_ENV === "development"
const ipcLog = process.env.ipcLog

// renderer to preload
const SEND_NAME = "electron-puppeteer_r2p"
// preload to renderer
const RECEIVE_NAME = "electron-puppeteer_p2r"
// ack prefix
const ACK_PREFIX = "ack_r2p_"
// browserWindow connect
export const BROWSER_WINDOW_PAGE_CONNECT = "electron-puppeteer_page_connect"

/**
 * @class Ipc
 */
export default class Ipc {
  /**
   * @constructor Ipc
   */
  constructor(webview, options) {
    this.webview = webview
    this.options = options || {}
    this._hold = false
    this._destroyed = false
    this._holdTasks = []
    this._listeners = []
    // UUID -> routingId的映射
    this._routingIdMaps = new Map()
    this._bindEvent()
  }
  /**
   * @typedef {Object} IpcEvent
   * @property {string} UUID iframe的UUID, mainFrame为～，任意frame为*
   * @property {string} name 消息名
   * @property {string} ack 回执消息名
   * @property {boolean} isMainFrame 是否为主页面
   * @property {IpcEvent} originalEvent 原生事件
   */
  /**
   * @typedef {Function} IpcListener
   * @param {IpcEvent} evt 消息对象
   * @param {Object} payload 消息数据
   */

  /**
   * 绑定消息监听事件
   * @private
   */
  _bindEvent() {
    this.webview.addEventListener("ipc-message", (originalEvent) => {
      if (originalEvent.channel === RECEIVE_NAME) {
        let evt = originalEvent.args[0]
        evt.originalEvent = originalEvent
        this._handleMessageEvent(evt)
      }
    })

    // 页面跳转之前
    // hold住所有消息，等完成后再继续发送，否则会丢失
    this.webview.addEventListener("will-navigate", () => {
      this._hold = true
      isDevelopment &&
        ipcLog &&
        console.warn("%cipc hold", "font-weight:bold;", this.webview)
    })

    const onRecover = () => {
      if (this._hold) {
        isDevelopment &&
          ipcLog &&
          console.warn("%cipc recover", "font-weight:bold;", this.webview)
        this._hold = false
        this._runHoldTasks()
      }
    }

    // 页面ready后重新发送消息
    this.webview.addEventListener("dom-ready", onRecover)

    this.webview.addEventListener("close", () => {
      this._destroyed = true
    })
    this.webview.addEventListener("destroyed", () => {
      this._destroyed = true
    })
  }
  _handleMessageEvent(evt) {
    if (evt.isAck) {
      isDevelopment &&
        ipcLog &&
        console.log(
          "%cipc ack",
          "font-weight:bold;color:green;",
          `name: ${evt.name},`,
          `UUID: ${evt.UUID},`,
          `payload: ${JSON.stringify(evt.payload)}`
        )
    } else {
      isDevelopment &&
        ipcLog &&
        console.log(
          "%cipc receive",
          "font-weight:bold;color:darkCyan;",
          `name: ${evt.name},`,
          `ack: ${evt.ack},`,
          `UUID: ${evt.UUID},`,
          `payload: ${JSON.stringify(evt.payload)}`
        )
    }

    if (!evt.isAck && evt.UUID !== "*") {
      this._routingIdMaps.set(evt.UUID, evt.routingId)
    }

    let results = []
    for (let i = 0; i < this._listeners.length; i++) {
      let item = this._listeners[i]
      if (
        (item.UUID === "*" || item.UUID === evt.UUID) &&
        [].concat(item.name).indexOf(evt.name) > -1 &&
        !!item.isAck === !!evt.isAck
      ) {
        let once = item.isAck || item.once
        results.push(
          item.listener.call(this.webview, evt.payload, evt, evt.error)
        )
        if (once) {
          this._listeners.splice(i--, 1)
        }
        // ack是唯一的，无需往后匹配
        if (item.isAck) {
          break
        }
      }
    }

    // reply
    // 没有ack则认为不需要回复
    if (!evt.isAck && evt.ack) {
      Promise.race(results.slice(0, 1)).then(
        (result) => {
          this._sendAck(evt.UUID, evt.ack, null, result, evt.isMainFrame)
        },
        (err) => {
          this._sendAck(
            evt.UUID,
            evt.ack,
            (err && err.toString()) || "-",
            null,
            evt.isMainFrame
          )
        }
      )
    }

    return results
  }
  _runHoldTasks() {
    while (this._holdTasks.length) {
      let task = this._holdTasks.shift()
      if (task.isAck) {
        this._sendAck(
          task.UUID,
          task.name,
          task.error,
          task.payload,
          task.isMainFrame
        )
      } else {
        this.send(
          task.UUID,
          task.name,
          task.payload,
          task.timeout,
          task.retry
        ).then(task.resolve, task.reject)
      }
    }
  }
  // 生成ack_name
  _generatorAckName(name) {
    return util.uniqueId(ACK_PREFIX + name + "_")
  }
  _sendAck(UUID, ack, err, payload, isMainFrame) {
    if (this._destroyed) {
      return false
    }
    if (this._hold) {
      this._holdTasks.push({
        UUID,
        name: ack,
        isAck: true,
        error: err,
        payload: payload,
        isMainFrame: isMainFrame,
      })
    } else {
      isDevelopment &&
        ipcLog &&
        console.log(
          "%cipc reply",
          "font-weight:bold;color:#c59519",
          `name: ${ack},`,
          `UUID: ${UUID},`,
          `result: ${JSON.stringify(payload)}`
        )

      let sender = this._getSender(UUID)
      if (sender) {
        try {
          sender(SEND_NAME, {
            UUID,
            name: ack,
            ack: "",
            error: err,
            isAck: true,
            payload: payload,
            isMainFrame: isMainFrame,
          })
        } catch (e) {}
      }
    }
  }
  _isWebviewInDocument() {
    return (
      (this.webview.isDestroyed && !this.webview.isDestroyed()) ||
      (this.webview.ownerDocument &&
        this.webview.ownerDocument.contains(this.webview))
    )
  }
  _getSender(UUID) {
    if (!this._isWebviewInDocument()) {
      return null
    }

    switch (UUID) {
      // any
      case "*":
        return (name, data) => {
          let sended = new Set()
          this._routingIdMaps.forEach((routingId) => {
            if (!sended.has(routingId)) {
              sended.add(routingId)
              let contentsId = this.webview.getWebContentsId()
              let contents = remote.webContents.fromId(contentsId)
              contents.sendToFrame(routingId, name, data)
            }
          })
        }
      // mainFrame
      case "~":
        return this.webview.send.bind(this.webview)
      // other
      default:
        let routingId = this._routingIdMaps.get(UUID)
        if (!routingId) {
          console.error("ipc reply error, failed to map routingId")
          throw "ipc error"
        }
        let contentsId = this.webview.getWebContentsId()
        let contents = remote.webContents.fromId(contentsId)
        return contents.sendToFrame.bind(contents, routingId)
    }
  }

  /**
   * 给webview内的指定iframe发送消息
   * @param {string} UUID iframe的UUID, mainFrame为～，任意frame为*
   * @param {string|string[]} name 消息名, 支持合并发送payload相同的消息
   * @param {Object} payload 传输数据
   * @param {number} timeout 等待回复时间
   * @param {number} retry 重试次数，默认不重试，仅在超时的情况才会重试
   *
   * @return {Promise<IpcEvent>} 返回promise，等待消息回复内容
   */
  send(UUID, name, payload, timeout, retry) {
    if (this._destroyed) {
      return Promise.reject("ipc webview destroyed")
    }

    if (Array.isArray(name)) {
      return Promise.all(
        name.map((item) => this.send(item, payload, timeout, retry))
      )
    }

    if (this._hold) {
      return new Promise((resolve, reject) => {
        this._holdTasks.push({
          resolve,
          reject,
          UUID,
          name,
          payload,
          timeout,
          retry,
          isAck: false,
        })
      })
    }

    timeout = timeout || this.options.timeout || 1e4
    let ack = this._generatorAckName(name)

    return new Promise((resolve, reject) => {
      // 收到回执信息，触发回调
      let onAck = (result, evt) => {
        window.clearTimeout(timer)
        if (evt.error) {
          return reject(evt.error)
        }
        resolve(result)
      }
      // 放入监听队列
      this._listeners.push({
        UUID,
        name: ack,
        listener: onAck,
        once: true,
        isAck: true,
      })
      // 超时判断
      let timer = window.setTimeout(() => {
        this.off(UUID, ack, onAck)
        let payloadString = JSON.stringify(payload)
        if (payloadString.length > 200) {
          payloadString = payloadString.substr(0, 200) + "..."
        }
        reject(`ipc.timeout.send: ${name}@${UUID}, payload: ${payloadString}`)
      }, timeout)

      retry = retry || 0

      isDevelopment &&
        ipcLog &&
        console.log(
          "%cipc send",
          "font-weight:bold;color:#00f",
          `name: ${name},`,
          `ack: ${ack},`,
          `UUID: ${UUID},`,
          `payload: ${JSON.stringify(payload)}`
        )

      // 获取发送消息的sender
      let sender = this._getSender(UUID)
      if (sender) {
        // 发送消息
        sender(SEND_NAME, {
          UUID,
          name,
          ack,
          payload,
          isAck: false,
        })
      }
    }).catch((err) => {
      if (typeof err === "string" && err.startsWith("ipc.timeout")) {
        isDevelopment &&
          ipcLog &&
          console.log(
            "%cipc timeout",
            "font-weight:bold;color:#f00",
            `name: ${name},`,
            `ack: ${ack},`,
            `UUID: ${UUID},`,
            `payload: ${JSON.stringify(payload)}`
          )
      } else {
        // console.error("ipc send error:", err)
      }

      if (--retry >= 0) {
        return this.send(UUID, name, payload, timeout, retry)
      }

      return Promise.reject(err)
    })
  }
  /**
   * 当收到某消息时立即发送指定消息给发送方, 和ack不同
   * @param {string} UUID iframe的UUID, mainFrame为～，任意frame为*
   * @param {string} trigger 触发的消息名
   * @param {string|string[]} name 消息名, 支持合并发送payload相同的消息
   * @param {Object} payload 传输数据
   */
  sendOn(UUID, trigger, name, payload) {
    this.on(UUID, trigger, () => {
      this.send(UUID, name, payload)
    })
  }
  /**
   * 监听webview内iframe消息
   * @param {string} UUID 消息来源iframe的UUID, mainFrame为～，任意frame为*
   * @param {string|string[]} name 消息名
   * @param {IpcListener} listener 响应函数
   * @param {boolean} unique 同名消息只绑定一次, 再次绑定时会取消前一次的绑定
   *
   * @return {Ipc} this
   *
   */
  on(UUID, name, listener, unique) {
    if (unique) {
      this.off(UUID, name)
    }

    this._listeners.push({
      UUID,
      name,
      listener,
      once: false,
      isAck: false,
    })
    return this
  }
  /**
   * 单次监听webview内的消息
   * @param {string} UUID iframe的UUID, mainFrame为～，任意frame为*
   * @param {string|string[]} name 消息名
   * @param {IpcListener} listener 响应函数
   *
   * @return {Ipc} this
   *
   */
  once(UUID, name, listener) {
    this._listeners.push({
      UUID,
      name,
      listener,
      once: true,
      isAck: false,
    })
    return this
  }
  /**
   * 取消监听
   * @param {string} UUID iframe的UUID, mainFrame为～，任意frame为*
   * @param {string|string[]} name 消息名
   * @param {IpcListener} [listener] 响应函数
   * @return {Ipc} this
   */
  off(UUID, name, listener) {
    this._listeners = this._listeners.filter((item) => {
      if (
        item.UUID === UUID &&
        item.name.toString() === name.toString() &&
        (!listener || item.listener === listener)
      ) {
        return false
      }
      return true
    })
    return this
  }
  /**
   * 模拟触发消息
   * @param {string} UUID iframe的UUID, mainFrame为～，任意frame为*
   * @param {string} name 消息名
   * @param {*} payload 消息参数
   * @param {*} error 错误信息
   * @return {*} 首个响应消息内容
   */
  dispatch(UUID, name, payload, error) {
    let results = this._handleMessageEvent({
      UUID,
      name,
      payload,
      error,
      isAck: false,
      ack: false,
    })

    return results.slice(0, 1)
  }
}

const ipcPool = new WeakMap()

/**
 * 已绑定了UUID的ipc
 */
export class BoundIpc {
  static setOptions(options) {
    BoundIpc.options = options
  }
  constructor(webview, UUID) {
    this.UUID = UUID

    if (ipcPool.has(webview)) {
      this.executor = ipcPool.get(webview)
    } else {
      this.executor = new Ipc(webview, BoundIpc.options)
      ipcPool.set(webview, this.executor)
    }
  }
  /**
   * 发送消息
   * @param {string|string[]} name 消息名, 支持合并发送payload相同的消息
   * @param {Object} payload 传输数据
   * @param {number} timeout 等待回复时间
   * @param {number} retry 重试次数，默认不重试，仅在超时的情况才会重试
   *
   * @return {Promise<IpcEvent>} 返回promise，等待消息回复内容
   */
  send(name, payload, timeout, retry) {
    return this.executor.send(this.UUID, name, payload, timeout, retry)
  }
  /**
   * 当收到某消息时立即发送指定消息给发送方, 和ack不同
   * @param {string} trigger 触发的消息名
   * @param {string|string[]} name 消息名, 支持合并发送payload相同的消息
   * @param {Object} payload 传输数据
   *
   * @return {BoundIpc} this
   */
  sendOn(trigger, name, payload) {
    this.executor.sendOn(this.UUID, trigger, name, payload)
    return this
  }
  /**
   * 监听消息
   * @param {string|string[]} name 消息名
   * @param {IpcListener} listener 响应函数
   * @param {boolean} unique 同名消息只绑定一次, 再次绑定时会取消前一次的绑定
   *
   * @return {BoundIpc} this
   *
   */
  on(name, listener, unique) {
    this.executor.on(this.UUID, name, listener, unique)
    return this
  }
  /**
   * 单次监听webview内的消息
   * @param {string|string[]} name 消息名
   * @param {IpcListener} listener 响应函数
   *
   * @return {BoundIpc} this
   *
   */
  once(name, listener) {
    this.executor.once(this.UUID, name, listener)
    return this
  }
  /**
   * 取消监听
   * @param {string|string[]} name 消息名
   * @param {IpcListener} listener 响应函数
   *
   * @return {BoundIpc} this
   *
   */
  off(name, listener) {
    this.executor.off(this.UUID, name, listener)
    return this
  }
  /**
   * 手动触发消息
   * @param {string} name 消息名
   * @param {*} payload 消息内容
   * @param {*} error 错误信息
   */
  dispatch(name, payload, error) {
    return this.executor.dispatch(this.UUID, name, payload, error)
  }
}
