/**
 * @fileoverview app.core.Router uses goog.History and hash tokens to hold and
 * manage the state of the application.
 * This class is modified mvc.Router class from PlastronJS library, please check
 * https://github.com/rhysbrettbowen/PlastronJS#mvcrouter for more details.
 * @author rhysbrettbowen@gmail.com <Rhys Brett-Bowen>
 * @author Dmytro Antonenko <dmitry.antonenko@pubwebkit.com>
 */

goog.provide('app.core.Router');

goog.require('goog.History');
goog.require('goog.array');
goog.require('goog.events');
goog.require('goog.history.EventType');
goog.require('goog.history.Html5History');
goog.require('goog.string');

/**
 * @param {boolean=} opt_noFragment set to true to hide fragment when using
 * HTML5 history.
 * @param {!goog.html.TrustedResourceUrl=} opt_blankPage url to a blank page -
 * needed if HTML5 is not
 * available and you don't want to show the fragment.
 * @param {HTMLInputElement=} opt_input The hidden input element to be used to
 * store the history token.  If not provided, a hidden input element will
 * be created using document.write.
 * @param {HTMLIFrameElement=} opt_iframe The hidden iframe that will be used by
 * IE for pushing history state changes, or by all browsers if opt_noFragment
 * is true. If not provided, a hidden iframe element will be created using
 * document.write.
 * @constructor
 * @extends {goog.events.EventTarget}
 */
app.core.Router =
    function(opt_noFragment, opt_blankPage, opt_input, opt_iframe) {
      app.core.Router.base(this, 'constructor');
      this.history_ = goog.history.Html5History.isSupported() ?
          new goog.history.Html5History() :
          new goog.History(!!(opt_blankPage && opt_noFragment),
              opt_blankPage, opt_input, opt_iframe);
      if (this.history_.setUseFragment) {
        this.history_.setUseFragment(!opt_noFragment);
      }
      goog.events.listen(this.history_, goog.history.EventType.NAVIGATE,
          this.onChange_, false, this);
      this.routes_ = [];
      this.currentFragment_ = '';
      this.history_.setEnabled(true);
    };
goog.inherits(app.core.Router, goog.events.EventTarget);

/**
 * Router event types.
 * @enum {string}
 */
app.core.Router.EventType = {
  // Event to trigger when route is about to change.
  ROUTE_EXPIRED: 'routeExpired'
};

/**
 * Pass through the fragment for the URL.
 * @param {string} fragment Fragment to set for the history token.
 */
app.core.Router.prototype.navigate = function(fragment) {
  this.history_.setToken(fragment);
};

/**
 * Returns current routed fragment.
 * @return {string} Routed fragment.
 */
app.core.Router.prototype.getFragment = function() {
  return this.currentFragment_;
};

/**
 * Define route as string or regex. /:abc/ will pass "abc" through as an
 * argument. *abc/def will pass through all after the * as an argument.
 * @param {string|RegExp} route to watch for.
 * @param {function(string)} fn should take in the token and any captured
 * strings.
 * @param {Object=} opt_context Object in whose context the function is to be
 *     called (the global scope if none).
 */
app.core.Router.prototype.route = function(route, fn, opt_context) {
  if (goog.isString(route)) {
    route = new RegExp('^' +
        goog.string.regExpEscape(route)
        .replace(/\\:\w+/g, '([a-zA-Z0-9._-]+)')
        .replace(/\\\*/g, '(.*)')
        .replace(/\\\[/g, '(')
        .replace(/\\\]/g, ')?')
        .replace(/\\\{/g, '(?:')
        .replace(/\\\}/g, ')?') +
        '$');
  }

  var completeRoute = {route: route, callback: fn, context: opt_context};
  this.routes_.push(completeRoute);
};

/**
 * Run route callback if route regexp matches fragment.
 * @param {Object} route Route object with context and route regexp.
 * @param {string} fragment URI fragment to match with.
 * @return {boolean}
 * @private
 */
app.core.Router.prototype.runRouteIfMatches_ = function(route, fragment) {
  var args = route.route.exec(fragment);
  if (args) {
    route.callback.apply(route.context, args);
    return true;
  }
  return false;
};

/**
 * Route change handler.
 * @private
 */
app.core.Router.prototype.onChange_ = function() {
  var fragment = this.history_.getToken();
  var locationPathname = window.location.pathname;

  if (goog.string.isEmptyOrWhitespace(fragment) &&
      locationPathname.length > 1) {
    fragment = locationPathname;
  }

  if (fragment !== this.currentFragment_) {
    var routes = this.routes_ || [];
    var findCallback = function(route) {
      return this.runRouteIfMatches_(route, fragment);
    };

    this.dispatchEvent({
      type: app.core.Router.EventType.ROUTE_EXPIRED,
      previous: this.currentFragment_,
      current: fragment
    });

    this.currentFragment_ = fragment;
    goog.array.find(routes, findCallback, this);
  }
};

/**
 * Go through all defined routes and run first matched.
 */
app.core.Router.prototype.checkRoutes = function() {
  var fragment = this.history_.getToken();
  var locationPathname = window.location.pathname;
  var routes = this.routes_ || [];
  var findCallback = function(route) {
    return this.runRouteIfMatches_(route, fragment);
  };

  if (goog.string.isEmptyOrWhitespace(fragment) &&
      locationPathname.length > 1) {
    fragment = locationPathname;
  }

  this.currentFragment_ = fragment;
  goog.array.find(routes, findCallback, this);
};
