var PromiseNP = require('../src/PromiseNP');


var _resolve = function(value){return new PromiseNP(function(resolve,_){resolve(value);});};
var _reject = function(reason){return new PromiseNP(function(_,reject){reject(reason);});};
module.exports = {
    resolve:_resolve,
    reject:_reject,
    deferred:function(){
        var _resolve = undefined;
        var _reject = undefined;
        var _promise = new PromiseNP(function(resolve, reject){_resolve = resolve; _reject = reject;});
        return {        
            promise:_promise,
            resolve:_resolve,
            reject:_reject
        };}
    };