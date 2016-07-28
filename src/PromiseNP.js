// Promise-Non-Primitive, browser only
// Promise/A+ test passed
+ function(global, name, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ?
        module.exports = factory() :
        typeof define === 'function' && define.amd ?
        define(factory) :
        (global[name] = factory());
}(this, 'Promise', function() {
    'use strict';
    // helper functions
    var globalThis = this;
    var isObject = function(o) {
            return o && typeof o === 'object';
        },
        isFunction = function(o) {
            return o && typeof o === 'function';
        },
        isInstanceOf = function(inst, type) {
            return inst instanceof type;
        },
        isThenable = function(obj) {
            return obj && typeof obj.then === 'function';
        },
        toArray = function(o) {
            return [].slice.call(o);
        },
        forEach = function(array, func) {
            for (var i = 0; i < array.length; ++i) {
                func(array[i], i, array);
            }
        },
        forEachAndShift = function(array, func) {
            var it;
            while (it = array.shift()) {
                func(it);
            }
        },
        until = function(ary, compareFunc) {
            var length = ary.length;

            for (var i = 0; i < length; i++) {
                if (compareFunc(ary[i])) {
                    return ary[i];
                }
            }

            return undefined;
        };

    // environment detections
    // these will hide internal states of promises if possible
    // using WeakMap as the perfect solution, Symbol comes second
    // otherwise, all promise states will be exposed

    // well-know async schedulers
    var asyncTaskSchedulers = [{
        usable: function() {
            return process && isFunction(process.nextTick);
        }, //(process && isFunction(process.nextTick)),
        scheduler: function() {
            // console.log('nexttick used')
            return process.nextTick;
        }
    }, {
        usable: function() {
            return isFunction(MutationObserver) && document && isFunction(document.createTextNode);
        },
        scheduler: function() {
            var togglee = 0;
            var triggerNode = document.createTextNode(togglee);
            var trigger = function() {
                triggerNode.data = (togglee + 1) % 2;
            }
            return function() {
                var task = undefined;
                if (arguments.length > 1) {
                    var args = toArray(arguments);
                    var task = args.shift();
                    // wrap task manually(not using bind) since task function may be variadic
                    var task = function() {
                        args[0].apply(args);
                    }
                } else {
                    task = arguments[0];
                }
                var mo = new MutationObserver(task);
                mo.observe(triggerNode, {
                    characterData: true
                });
                trigger();
            }
        }
    }, {
        usable: function() {
            return isFunction(setTimeout);
        },
        scheduler: function() {
            return function() {
                if (arguments.length > 1) {
                    var args = toArray(arguments);
                    args.splice(1, 0, 0);
                    setTimeout.apply(null, args);
                } else {
                    setTimeout(arguments[0]);
                }
            }
        }
    }];

    var asyncTaskScheduler = (function() {
        var selected = until(asyncTaskSchedulers, function(o) {
            try {
                return o.usable();
            } catch (e) {
                return false;
            }
        });
        if (selected) {
            return selected.scheduler();
        } else {
            throw new Error('No available scheduler.');
        }
    })();

    var accessLayerFunctionList = [{
        usable: isFunction(WeakMap),
        functions: function() {
            var promiseInstanceMap = new WeakMap();
            var _getProperty = function(inst, name) {
                    var props = promiseInstanceMap.get(inst);
                    return props ? props[name] : undefined;
                },
                _setProperty = function(inst, name, value) {
                    if (promiseInstanceMap.has(inst)) {
                        promiseInstanceMap.get(inst)[name] = value;
                    } else {
                        promiseInstanceMap.set(inst, {});
                        _setProperty(inst, name, value);
                    }
                }
            return {
                getProperty: _getProperty,
                setProperty: _setProperty
            };
        }
    }, {
        usable: isFunction(Symbol),
        functions: function() {
            var states = Symbol();
            return {
                getProperty: function(inst, name) {
                    return inst[states][name];
                },
                setProperty: function(inst, name, value) {
                    return inst[states][name] = value;
                }
            }
        }
    }, {
        usable: true,
        functions: function() {
            return {
                setProperty: function(inst, name) {
                    return inst[name];
                },
                getProperty: function(inst, name, value) {
                    return inst[name] = value;
                }
            }
        }
    }];

    var accessLayerFunctions = (until(accessLayerFunctionList,
        function(x) {
            return x.usable;
        }
    )).functions();


    var setProperty = accessLayerFunctions.setProperty,
        getProperty = accessLayerFunctions.getProperty;

    // constants
    // internal property names
    var propFulfillHanlderQueue = '__fulfillHandlerQueue__',
        propRejectHandlerQueue = '__rejectHandlerQueue__',
        propValue = '__value__',
        propState = '__state__';

    // states
    var pStatePending = 'PENDING',
        pStateFulfilled = 'FULFILLED',
        pStateRejected = 'REJECTED';

    // messages 
    var msgPromiseAllParameterNotIterable = 'Argument 1 of Promise.all is not iterable',
        msgPromiseRaceParameterNotIterable = 'Argument 1 of Promise.race is not iterable',
        msgPromiseConstructorRequiresNew = 'Constructor Promise requires \'new\'.',
        msgPromiseExecutorNotCallable = 'Argument 1 of Promise.constructor is not a callable.',
        msgNotAvailableScheduler = 'No available scheduler';

    // dummy executor
    var nop = function() {};

    var scheduleAsyncTask = function(task) {
        var actualTask = task;
        if (arguments.length > 1) {
            var args = toArray(arguments);
            args.splice(0, 1);
            var actualTask = function() {
                task.apply(null, args);
            }
        }
        asyncTaskScheduler(actualTask);
    }

    // on queue properties
    var appendFulfillHandler = function(inst, func) {
            getProperty(inst, propFulfillHanlderQueue).push(func);
        },
        appendRejectHandler = function(inst, func) {
            getProperty(inst, propRejectHandlerQueue).push(func)
        },
        getFulfillHandlerQueue = function(inst) {
            return getProperty(inst, propFulfillHanlderQueue);
        },
        getRejectHandlerQueue = function(inst) {
            return getProperty(inst, propRejectHandlerQueue);
        };

    // on state and value properties
    var setState = function(inst, state) {
            setProperty(inst, propState, state);
        },
        getState = function(inst) {
            return getProperty(inst, propState);
        },
        setValue = function(inst, value) {
            setProperty(inst, propValue, value);
        },
        getValue = function(inst) {
            return getProperty(inst, propValue);
        },
        resetQueues = function(inst) {
            setProperty(inst, propFulfillHanlderQueue, []);
            setProperty(inst, propRejectHandlerQueue, []);
        };

    var scheduleAppropriateHandlers = function(promise) {
        var state = getProperty(promise, propState);
        var value = getProperty(promise, propValue);
        if (state === pStateFulfilled) {
            scheduleAsyncTask(function() {
                forEachAndShift(getFulfillHandlerQueue(promise),
                    function(t) {
                        t.call(null, value);
                    }
                );
                // setProperty(promise, propFulfillHanlderQueue, []);
            });
        } else if (state === pStateRejected) {
            scheduleAsyncTask(function() {
                forEachAndShift(getRejectHandlerQueue(promise),
                    function(t) {
                        t.call(null, value);
                    }
                );
                // setProperty(promise, propRejectHandlerQueue, []);
            });
        }
    };
    var settleAndScheduleHandlers = function(promise, dstState, value) {
        var state = getState(promise);
        if (state === pStatePending) {
            setState(promise, dstState);
            setValue(promise, value);
            scheduleAppropriateHandlers(promise);
        }
    }

    var initInternalStates = function(promise) {
        setState(promise, pStatePending);
        setValue(promise, undefined);
        resetQueues(promise);
    };

    var PromiseNP = function(executor) {
        if (!isInstanceOf(this, PromiseNP)) {
            throw new TypeError(msgPromiseConstructorRequiresNew);
        }
        if (!isFunction(executor)) {
            throw new TypeError(msgPromiseExecutorNotCallable);
        }

        initInternalStates(this);

        var resolveThis = resolvePromise.bind(null, this),
            rejectThis = rejectPromise.bind(null, this);

        try {
            executor(resolveThis, rejectThis);
        } catch (e) {
            rejectThis(e);
        }
    };

    var adoptState = function(dstPromise, srcPromise) {
        var srcState = getState(srcPromise);
        var srcValue = getValue(srcPromise);

        if (srcState === pStatePending) {
            srcPromise.then(function(value) {
                    resolve(dstPromise, value);
                },
                function(reason) {
                    rejectPromise(dstPromise, reason);
                }
            )
        } else if (srcState === pStateFulfilled) {
            resolve(dstPromise, srcValue);
        } else {
            rejectPromise(dstPromise, srcValue);
        }
    };

    var resolvePromiseR = function(promise, value) {
        if (value instanceof PromiseNP) {
            value.then(resolvePromise.bind(null, promise),
                rejectPromise.bind(null, promise));
        } else {
            settleAndScheduleHandlers(promise, pStateFulfilled, value);
        }
    }

    var simpleResolvePromise = function(promise, value) {
            settleAndScheduleHandlers(promise, pStateFulfilled, value);
        },
        rejectPromise = function(promise, reason) {
            settleAndScheduleHandlers(promise, pStateRejected, reason);
        };


    // resolvePromise = resolvePromiseA;
    // rejectPromise = rejectPromiseA;

    // resolvePromise = resolvePromiseA;

    var resolve = function(promise, x) {
        // if (getState(promise) !== pStatePending) {
        //     return;
        // }
        if (promise === x) {
            return rejectPromise(promise, new TypeError('attempting to self-resolve.'));
        } else if (x instanceof PromiseNP) {
            return adoptState(promise, x);
        } else if (isFunction(x) || isObject(x)) {
            try {
                var then = x.then;
            } catch (e) {
                return rejectPromise(promise, e);
            }
            if (isFunction(then)) {
                var called = false;
                var proxyOnFulfilled = function(value) {
                        if (!called) {
                            called = true;
                            resolve(promise, value);
                        }
                    },
                    proxyOnRejected = function(reason) {
                        if (!called) {
                            called = true;
                            rejectPromise(promise, reason);
                        }
                    };
                try {
                    then.call(x, proxyOnFulfilled, proxyOnRejected);
                } catch (e) {
                    if (!called) {
                        return rejectPromise(promise, e);
                    }
                }
            } else {
                return simpleResolvePromise(promise, x);
            }
        } else {
            return simpleResolvePromise(promise, x);
        }
    }

    var resolvePromise = resolve;
    var then = function(onFulfilled, onRejected) {
        var ret = new PromiseNP(nop);
        var thisState = getState(this);
        var called = false;
        var self = this;
        var value = getProperty(this, propValue);
        var wrapper = function(func) {
            return function(value) {
                if (called) {
                    return;
                }
                called = true;
                try {
                    var result = func(value);
                } catch (e) {
                    rejectPromise(ret, e);
                }
                resolve(ret, result);
            }
        };

        onFulfilled = isFunction(onFulfilled) ? onFulfilled : function(value) {
            return value;
        };
        onRejected = isFunction(onRejected) ? onRejected : function(reason) {
            throw reason;
        };

        onFulfilled = wrapper(onFulfilled.bind(globalThis));
        onRejected = wrapper(onRejected.bind(globalThis));

        if (thisState === pStatePending) {
            appendFulfillHandler(self, onFulfilled);
            appendRejectHandler(self, onRejected);
            return ret;
        } else if (thisState === pStateFulfilled) {
            appendFulfillHandler(self, onFulfilled);
            // appendRejectHandler(self, onRejected);
            scheduleAppropriateHandlers(self);
            return ret;
        } else {
            // appendFulfillHandler(self, onFulfilled);
            appendRejectHandler(self, onRejected);
            scheduleAppropriateHandlers(self);
            return ret;
        }
    }
    var createResolve = function(value) {
            return new PromiseNP(function(resolve) {
                resolve(value);
            });
        },
        createReject = function(reason) {
            return new PromiseNP(function(resolve, reject) {
                reject(reason);
            });
        },
        // not detecting any iterator protocal here
        // in both Chrome and Firefox, the iterable could contain custom thenables, 
        // which would be handled by resolve, and non-thenable non-Promise elements in the iterable
        // would treated as resolved as well
        createAll = function(promises) {
            var length;
            var cnt = 0;
            if (promises === null || typeof(length = promises.length) === 'undefined') {
                return new Promise(function(_, reject) {
                    reject(new TypeError(msgPromiseAllParameterNotIterable));
                });
            }
            var executor = function(resolve, reject) {
                if (length === 0) {
                    resolve([]);
                }
                forEach(promises,
                    function(p, i) {
                        if (isThenable(p)) {
                            var onFulfilled = function(value) {
                                    values[i] = value;
                                    ++cnt;
                                    if (cnt === length) {
                                        resolve(values);
                                    }
                                },
                                onRejected = function(reason) {
                                    reject(reason);
                                }
                            p.then(onFulfilled, onRejected);
                        } else {
                            ++cnt;
                            value[i] = p;
                            if (cnt === length) {
                                resolve(values);
                            }
                        }
                    });
            };

            return new PromiseNP(exectuor);
        },
        createRace = function(promises) {
            var length;
            if (promises === null || typeof(length = promises.length) === 'undefined') {
                return new Promies(function(_, rject) {
                    reject(new TypeError(msgPromiseRaceParameterNotIterable));
                });
            }
            var exectuor = function(resolve, reject) {
                forEach(promises,
                    function(p) {
                        var onFulfilled = function(value) {
                                resolve(value);
                            },
                            onRejected = function(reason) {
                                reject(value);
                            }
                        p.then(onFulfilled, onRejected);
                    });
            }

            return new PromiseNP(exectuor);
        };

    PromiseNP.prototype.then = then;
    PromiseNP.resolve = createResolve;
    PromiseNP.reject = createReject;
    PromiseNP.all = createAll;
    PromiseNP.race = createRace;

    return PromiseNP;
});