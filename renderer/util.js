/**
 * @file util
 */

export function uniqueId(prefix) {
  return (
    (prefix || "") +
    Math.random().toString(32).substr(1) +
    Date.now().toString(32)
  );
}

export function loggerDecorator(target, name, descriptor) {
  var oldValue = descriptor.value;

  if (
    typeof descriptor.value === "function" &&
    process.env.NODE_ENV === "development"
  ) {
    descriptor.value = function () {
      var args = [].slice.call(arguments);

      // hidden pwd, password
      args = args.map(function (item) {
        var keys = (item && Object.keys(item)) || [];
        if (keys.indexOf("pwd") > -1 || keys.indexOf("password") > -1) {
          return Object.assign({}, item, { pwd: "******" });
        }
      });

      console.info(`Calling ${target.constructor.name}.${name}: ${target} ,with: `, ...args);

      var ret = oldValue.apply(this, arguments);

      if (ret && ret.then) {
        ret.then((ret) => {
          console.info(`Return ${target.constructor.name}.${name}: ${target} ,with`, ret);
        });
      } else {
        console.info(`Return ${target.constructor.name}.${name}: ${target} ,with`, ret);
      }

      return ret;
    };
  }

  return descriptor;
}

// 拓展指定类的原型方法，方法涞源于自己的其它函数的返回值，如page的goto方法来源于page.mainFrame()
export function proxyBindDecorator(proxyMethods, proxierGetFn) {
  return function (target) {
    proxyMethods.forEach(methodName => {
      target.prototype[methodName] = function () {
        var proxier = proxierGetFn.call(this)
        return proxier[methodName].apply(proxier, arguments)
      }
    })

    return target
  }
}

// 插入style节点
export function importStyle(styleContent) {
  var style = document.createElement("style");
  style.type = "text/css";
  document.getElementsByTagName("head")[0].appendChild(style);
  if (style.styleSheet) {
    style.styleSheet.cssText = styleContent
  } else {
    style.appendChild(document.createTextNode(styleContent))
  }
}

export function TimeoutPromise(fn, timeout) {
  return new Promise(function (resolve, reject) {
    var timer;
    var ctx = {
      isTimeout: false,
      timeoutCallback: null,
      rejectCallback: null
    };
    if (timeout) {
      timer = setTimeout(function () {
        ctx.isTimeout = true;
        if (ctx.timeoutCallback) {
          ctx.timeoutCallback();
        }
        reject('promise.timeout');
        if (ctx.rejectCallback) {
          ctx.rejectCallback();
        }
      }, timeout)
    }

    function rewriteResolve(data) {
      if (ctx.isTimeout) {
        return;
      }

      if (timer) {
        clearTimeout(timer);
      }

      resolve(data);
    }

    function rewriteReject(err) {
      if (ctx.isTimeout) {
        return;
      }

      if (timer) {
        clearTimeout(timer);
      }

      reject(err);
      if (ctx.rejectCallback) {
        ctx.rejectCallback();
      }
    }


    fn.call(this, rewriteResolve, rewriteReject, ctx);
  })
}

export default {
  uniqueId,
  loggerDecorator,
  proxyBindDecorator,
  importStyle,
  TimeoutPromise
}