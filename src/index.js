var Cpass = require("cpass");
var cpass = new Cpass();
var cors = require("cors");
var path = require('path');
var mkdirp = require('mkdirp');

var spf = spf || {};
spf.restProxy = function(settings) {
    var express = require("express");
    var app = express();
    var bodyParser = require("body-parser");
    var fs = require("fs");
    var sprequest = require("sp-request");
    var prompt = require("prompt");

    // default settings
    settings.configPath = path.join(settings.configPath || __dirname + "/../config/_private.conf.json");
    settings.port = settings.port || 8080;
    settings.staticRoot = path.join(settings.staticRoot || __dirname + "/../src");
    // default settings

    var _self = this;

    var configPath = settings.configPath;

    _self.initContext = function(callback) {
        console.log("Config path: " +  settings.configPath);
        fs.exists(configPath, function(exists) {
            if (exists) {
                _self.ctx = require(configPath);
                _self.ctx.password = cpass.decode(_self.ctx.password);
                if (callback && typeof callback === "function") {
                    callback();
                }
            } else {
                var promptFor = [];
                promptFor.push({
                    description: "SharePoint Site Url",
                    name: "siteUrl",
                    type: "string",
                    required: true
                });
                promptFor.push({
                    description: "User login",
                    name: "username",
                    type: "string",
                    required: true
                });
                promptFor.push({
                    description: "Domain (for On-Prem only)",
                    name: "domain",
                    type: "string",
                    required: false
                });
                promptFor.push({
                    description: "Password",
                    name: "password",
                    type: "string",
                    hidden: true,
                    replace: "*",
                    required: true
                });
                promptFor.push({
                    description: "Do you want to save config to disk?",
                    name: "save",
                    type: "boolean",
                    default: true,
                    required: true
                });
                prompt.start();
                prompt.get(promptFor, function (err, res) {
                    var json = {};
                    json.siteUrl = res.siteUrl;
                    json.username = res.username;
                    json.password = cpass.encode(res.password);
                    if (res.domain.length > 0) {
                        json.domain = res.domain;
                    }
                    _self.ctx = json;
                    if (res.save) {
                        var saveFolderPath = path.dirname(configPath);
                        mkdirp(saveFolderPath, function(err) {
                            if (err) {
                                console.log("Error creating folder " + "`" + saveFolderPath + " `", err);
                            };
                            fs.writeFile(configPath, JSON.stringify(json), "utf8", function(err) {
                                if (err) {
                                    console.log(err);
                                    return;
                                }
                                console.log("Config file is saved to " + configPath);
                            });
                        });
                    }
                    if (callback && typeof callback === "function") {
                        callback();
                    }
                });
            }
        });
    };

    _self.spr = null;

    _self.port = process.env.PORT || settings.port;
    _self.routers = {
        apiRouter: express.Router(),
        staticRouter: express.Router()
    };

    _self.getCachedRequest = function(spr) {
        var env = {};
        if (_self.ctx.hasOwnProperty("domain")) {
            env.domain = _self.ctx.domain;
        }
        if (_self.ctx.hasOwnProperty("workstation")) {
            env.workstation = _self.ctx.workstation;
        }
        spr = spr || require("sp-request").create(_self.ctx, env);
        return spr;
    };

    _self.routers.apiRouter.get("/*", function(req, res) {
        _self.spr = _self.getCachedRequest(_self.spr);
        console.log("GET: " + _self.ctx.siteUrl + req.originalUrl);
        var requestHeadersPass = {};
        if (req.headers["accept"]) {
            requestHeadersPass["accept"] = req.headers["accept"];
        }
        if (req.headers["content-type"]) {
            requestHeadersPass["content-type"] = req.headers["content-type"];
        }
        _self.spr.get(_self.ctx.siteUrl + req.originalUrl, {
            headers: requestHeadersPass
        })
            .then(function (response) {
                res.status(response.statusCode);
                res.json(response);
            })
            .catch(function (err) {
                res.status(err.statusCode);
                res.json(err);
            });
    });

    _self.routers.apiRouter.post("/*", function(req, res) {
        // res.json({
        //     method: req.method,
        //     headers: req.headers,
        //     url: req.url,
        //     baseUrl: req.baseUrl,
        //     body: req.body
        // });

        // console.log("=== Headers", req.headers);
        // console.log("=== Body", req.body);
        // console.log("=== Data", req.data);

        _self.spr = _self.getCachedRequest(_self.spr);
        console.log("POST: " + _self.ctx.siteUrl + req.originalUrl);
        var requestHeadersPass = {};
        if (req.headers["accept"]) {
            requestHeadersPass["accept"] = req.headers["accept"];
        }
        if (req.headers["content-type"]) {
            requestHeadersPass["content-type"] = req.headers["content-type"];
        }
        _self.spr.requestDigest(_self.ctx.siteUrl, {
            headers: requestHeadersPass
        })
            .then(function (digest) {
                // console.log("Gigest: " + digest)

                return _self.spr.post(_self.ctx.siteUrl + req.originalUrl, {
                    headers: {
                        "X-RequestDigest": digest,
                        "Accept": "application/json; odata=verbose",       // ToDo - pass through proxy
                        "Content-Type": "application/json; odata=verbose"  // ToDo - pass through proxy
                    }
                });
            })
            .then(function (response) {
                res.status(response.statusCode);
                res.json(response);
            })
            .catch(function (err) {
                res.status(err.statusCode);
                res.json(err);
            });
    });

    _self.routers.staticRouter.get("/*", function(req, res) {
        var filename;
        var url = "/index.html";
        if (req.url !== "/") {
            url = req.url;
        }
        if (req.url === "/config") {
            var response = {
                siteUrl: _self.ctx.siteUrl,
                username: _self.ctx.username
            };
            res.json(response);
            return;
        }
        // res.sendFile(__dirname + url);
        res.sendFile(path.join(settings.staticRoot + url));
    });

    _self.serve = function() {
        _self.initContext(function() {
            app.use(bodyParser.urlencoded({ extended: true }));
            app.use(bodyParser.json());
            app.use(cors());
            app.use("*/_api", _self.routers.apiRouter);
            app.use("/", _self.routers.staticRouter);
            app.listen(_self.port);
            console.log("SharePoint REST Proxy has been started on port " + _self.port);
        });
    };
    return _self;
};

// var restProxy = new spf.restProxy();
// restProxy.serve();

module.exports = spf.restProxy;