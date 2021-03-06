/**
 * @fileoverview Main MVC application class.
 * @author Dmytro Antonenko <dmitry.antonenko@pubwebkit.com>
 */

goog.provide('app.core.Application');
goog.provide('app.core.Application.EventType');

goog.require('app.core.ApplicationFilter');
goog.require('app.core.Request');
goog.require('app.core.Response');
goog.require('app.core.Router');
goog.require('app.core.events.ActionEvent');
goog.require('app.core.events.ActionExceptionEvent');
goog.require('app.core.types.ActionFilterContext');
goog.require('app.core.types.ActionFilterItem');
goog.require('app.core.types.ApplicationFilterItem');
goog.require('goog.Promise');
goog.require('goog.array');
goog.require('goog.dom');
goog.require('goog.events');
goog.require('goog.events.EventTarget');
goog.require('goog.string');

/**
 * @constructor
 * @extends {goog.events.EventTarget}
 */
app.core.Application = function() {
  goog.events.EventTarget.call(this);

  /**
   * @type {HTMLInputElement}
   */
  var historyStateInput =
      /** @type {HTMLInputElement} **/
      (goog.dom.createDom('input', {
        'type' : 'text',
        'id' : 'history_state',
        'name' : 'history_state',
        'style' : 'display:none'
      }));

  document.body.appendChild(historyStateInput);

  /**
   * @type {app.core.Router}
   * @private
   */
  this.router_ = new app.core.Router(false, undefined, historyStateInput);

  /**
   * @type {Array.<app.core.types.ActionFilterItem>}
   * @private
   */
  this.actionFilters_ = [];

  /**
   * @type {Array.<app.core.types.ApplicationFilterItem>}
   * @private
   */
  this.applicationFilters_ = [];

  /**
   * The fragment we are mapping the controller to.
   * @type {RegExp}
   * @private
   */
  this.currentRoute_;

  /**
   * @type {boolean}
   * @private
   */
  this.isFirstLoad_ = true;

  // Initialize and run application.
  this.init();
};
goog.inherits(app.core.Application, goog.events.EventTarget);

/**
 * @param {string} route The path The fragment we are mapping the controller
 * to.
 * @param {!Function} controller The name or object that identifying the
 * desired controller.
 */
app.core.Application.prototype.mapRoute = function(route, controller) {
  this.router_.route(route, goog.bind(
      goog.partial(this.processRoute_, route, new controller()), this));
};

/**
 * @param {string} route The fragment we are mapping the controller to.
 * @param {app.core.Controller} controller Controller instance related to
 *    current route.
 * @private
 */
app.core.Application.prototype.processRoute_ = function(route, controller) {
  this.setCurrentRoute_(route);

  var i = 2;
  var routeData = {
    'controller': controller.getControllerName()
  };
  var pattern = /:[a-zA-Z0-9._-]*/g;
  var request;
  var response;
  var filterContext;
  var match;
  var queryVals = arguments[arguments.length - 1];

  while ((match = pattern.exec(route)) !== null) {
    i++;
    routeData[goog.string.removeAll(match[0], ':')] = arguments[i];
  }

  if (!goog.isDefAndNotNull(routeData['action'])) {
    routeData['action'] = 'index';
  }

  routeData['isFirstLoad'] = this.isFirstLoad_;

  request = new app.core.Request(routeData, window.location.href, queryVals);
  response = new app.core.Response(request, this.router_);
  filterContext = new app.core.types.ActionFilterContext(request, response);

  /**
   * @constructor
   */
  var instance = Object.create(controller);

  if (goog.isFunction((instance[routeData['action']]))) {

    try {
      new goog.Promise(
          function(resolve, reject) {
            this.dispatchEvent(new app.core.events.ActionEvent(
                filterContext,
                app.core.Application.EventType.ACTIONEXECUTING,
                resolve, this));
          }, this)
      .then(
          function() {
            return new goog.Promise(function(resolve, reject) {
              resolve(instance[routeData['action']](request, response));
            });
          },
          undefined, this)
      .then(
          function() {
            return new goog.Promise(function(resolve, reject) {
              this.dispatchEvent(new app.core.events.ActionEvent(
                  filterContext,
                  app.core.Application.EventType.ACTIONEXECUTED, resolve,
                  this));
            }, this);
          },
          undefined, this)
      .then(function() {
        return new goog.Promise(function(resolve, reject) {
          // Application loaded
          resolve(this.dispatchEvent(
              app.core.Application.EventType.APPLICATIONLOADED));
        }, this);
      }, undefined, this);

    } catch (err) {
      this.dispatchEvent(
          new app.core.events.ActionExceptionEvent(filterContext, this, err));
    }

  } else {
    throw new Error('Action "' + routeData['action'] + '" does not exist!');
  }
};

/**
 * Register application filter
 * @param {!app.core.ApplicationFilter} filter
 * @param {number=} opt_order
 */
app.core.Application.prototype.addApplicationFilter =
    function(filter, opt_order) {
      goog.array.insert(this.applicationFilters_,
          new app.core.types.ApplicationFilterItem(filter, opt_order));
    };

/**
 * Register action filter
 * @param {!app.core.ActionFilter} filter
 * @param {string|RegExp=} opt_route Route to watch for.
 * @param {number=} opt_order
 */
app.core.Application.prototype.addActionFilter =
    function(filter, opt_route, opt_order) {
      goog.array.insert(this.actionFilters_,
          new app.core.types.ActionFilterItem(filter, opt_route, opt_order));
    };

/**
 * Start application execution
 */
app.core.Application.prototype.run = function() {
  // Initialize events
  this.listenOnce(app.core.Application.EventType.APPLICATIONSTART,
      this.onApplicationStart_, false, this);
  this.listenOnce(app.core.Application.EventType.APPLICATIONRUN,
      this.onApplicationRun_, false, this);
  this.listenOnce(app.core.Application.EventType.APPLICATIONLOADED,
      this.onApplicationLoaded_, false, this);
  this.listen(app.core.Application.EventType.ACTIONEXCEPTION,
      this.onActionException_, false, this);
  this.listen(app.core.Application.EventType.ACTIONEXECUTING,
      this.onActionExecuting_, false, this);
  this.listen(app.core.Application.EventType.ACTIONEXECUTED,
      this.onActionExecuted_, false, this);

  // Sort application filters
  goog.array.sort(this.applicationFilters_, function(a, b) {
    return a.getOrder() - b.getOrder();
  });

  // Application start
  this.dispatchEvent(app.core.Application.EventType.APPLICATIONSTART);

  // Sort action filters
  goog.array.sort(this.actionFilters_, function(a, b) {
    return a.getOrder() - b.getOrder();
  });

  // Check current route
  this.router_.checkRoutes();

  // Application run
  this.dispatchEvent(app.core.Application.EventType.APPLICATIONRUN);
};

/**
 * Called before the action method is invoked.
 * @param {app.core.events.ActionEvent} e
 * @private
 */
app.core.Application.prototype.onActionExecuting_ = function(e) {
  this.forEachActionFilter_(function(filterItem) {
    filterItem.getFilter().onActionExecuting(e);
  });
  e.resolvePromise();
};

/**
 * Called after the action method is invoked.
 * @param {app.core.events.ActionEvent} e
 * @private
 */
app.core.Application.prototype.onActionExecuted_ = function(e) {
  this.forEachActionFilter_(function(filterItem) {
    filterItem.getFilter().onActionExecuted(e);
  });
  e.resolvePromise();
};

/**
 * Called when an unhandled exception occurs in the action.
 * @param {app.core.events.ActionExceptionEvent} e
 * @private
 */
app.core.Application.prototype.onActionException_ = function(e) {
  this.forEachActionFilter_(function(filterItem) {
    filterItem.getFilter().onException(e);
  });
  e.resolvePromise();
};

/**
 * Called when an application start initialization.
 * @param {goog.events.Event} e
 * @private
 */
app.core.Application.prototype.onApplicationStart_ = function(e) {
  this.forEachApplicationFilter_(function(filterItem) {
    filterItem.getFilter().onApplicationStart(e);
  });
};

/**
 * Called when an application end initialization.
 * @param {goog.events.Event} e
 * @private
 */
app.core.Application.prototype.onApplicationRun_ = function(e) {
  this.forEachApplicationFilter_(function(filterItem) {
    filterItem.getFilter().onApplicationRun(e);
  });
};

/**
 * Called when an application launched.
 * @param {goog.events.Event} e
 * @private
 */
app.core.Application.prototype.onApplicationLoaded_ = function(e) {
  this.forEachApplicationFilter_(function(filterItem) {
    filterItem.getFilter().onApplicationLoaded(e);
  });
  this.isFirstLoad_ = false;
};

/**
 * Calls a function for each registered application filter.
 * @param {Function} callback
 * @private
 */
app.core.Application.prototype.forEachApplicationFilter_ = function(callback) {
  goog.array.forEach(this.applicationFilters_, function(filterItem) {
    callback.call(this, filterItem);
  }, this);
};

/**
 * Calls a function for each registered action filter, but skip filters with
 * route that not match current route.
 * @param {Function} callback
 * @private
 */
app.core.Application.prototype.forEachActionFilter_ = function(callback) {
  var currentRoute = this.currentRoute_;
  goog.array.forEach(this.actionFilters_, function(filterItem) {
    // Check route and run
    var route = filterItem.getRoute();

    if (goog.string.isEmptyOrWhitespace(goog.string.makeSafe(route)) ||
        currentRoute.exec(route)) {
      callback.call(this, filterItem);
    }
  }, this);
};

/**
 * @param {string} route
 * @private
 */
app.core.Application.prototype.setCurrentRoute_ = function(route) {
  this.currentRoute_ =
      new RegExp('^' +
          goog.string.regExpEscape(route)
          .replace(/\\:\w+/g, '([a-zA-Z0-9._-]+)')
          .replace(/\\\*/g, '(.*)')
          .replace(/\\\[/g, '(')
          .replace(/\\\]/g, ')?')
          .replace(/\\\{/g, '(?:')
          .replace(/\\\}/g, ')?') +
          '$');
};

/**
 * Initialize application.
 */
app.core.Application.prototype.init = goog.abstractMethod;


/**
 * Constants for event type fired by Application.
 * @enum {string}
 */
app.core.Application.EventType = {
  APPLICATIONSTART: goog.events.getUniqueId('application_start'),
  APPLICATIONRUN: goog.events.getUniqueId('application_start'),
  APPLICATIONLOADED: goog.events.getUniqueId('application_loaded'),
  ACTIONEXCEPTION: goog.events.getUniqueId('action_exception'),
  ACTIONEXECUTING: goog.events.getUniqueId('action_executing'),
  ACTIONEXECUTED: goog.events.getUniqueId('action_executed')
};
