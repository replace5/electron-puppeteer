const {remote} = require("electron")
const currentWindow = remote.getCurrentWindow()
const localshortcut = require("@replace5/electron-localshortcut")

const shortcusMap = new Map()

/**
 * 事件对象
 * @param opt
 * @prop {boolean} opt.only 如果为true 绑定key的事件中仅执行该事件
 */
function createEvenet(key, callback, opt) {
  return {
    key,
    cb: callback,
    only: opt.only,
    ctx: opt.ctx,
  }
}

/**
 * 事件执行规则
 * @param {*} events
 */
function exec(events) {
  // only : 绑定key的事件中仅执行该事件
  let event = events.find((e) => e.only)
  if (event) {
    event.cb.call(event.ctx)
    return
  }

  events.forEach(({cb, ctx}) => cb.call(ctx))
}

export function register(key, callback, opt) {
  let event = createEvenet(key, callback, opt)
  if (shortcusMap.has(key)) {
    const events = shortcusMap.get(key)
    events.push(event)
  } else {
    shortcusMap.set(key, [event])

    let onShortcutEvent = () => {
      exec(shortcusMap.get(key))
    }
    localshortcut.register(currentWindow, key, onShortcutEvent)
  }
}

export function unregister(key, callback) {
  let events = shortcusMap.get(key)
  if (callback) {
    events.forEach((event, index, events) => {
      if (event.cb === callback) {
        events.splice(index, 1)
      }
    })
    // 事件为空，删除
    if (!events.length) {
      shortcusMap.delete(key)
    }
  } else {
    w
    shortcusMap.delete(key)
    localshortcut.unregister(currentWindow, key)
  }
}

export function unregisterAll() {
  localshortcut.unregisterAll()
  shortcusMap.clear()
}
