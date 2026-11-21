/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-7e5eb42b'], (function (workbox) { 'use strict';

  importScripts("push-sw.js");
  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "registerSW.js",
    "revision": "402b66900e731ca748771b6fc5e7a068"
  }, {
    "url": "push-sw.js",
    "revision": "6a64852a93c49cac10703a87a4bfb2e9"
  }, {
    "url": "index.html",
    "revision": "6f5f0a2337237c581ffad9308d78aa0f"
  }, {
    "url": "icon-maskable-512.png",
    "revision": "23b2897e7bb41399eb475bbeb3d8bc08"
  }, {
    "url": "icon-512.png",
    "revision": "3227b096989012ed1c81ea455349ed97"
  }, {
    "url": "icon-192.png",
    "revision": "db7ab28c08abd651819a3a0f6a48c2a4"
  }, {
    "url": "favicon.svg",
    "revision": "53d2ca48046fb3f366b0e176649551e1"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "ee5168d3b680fbfbd68389f4aa6267ca"
  }, {
    "url": "assets/seed-92NNnFuU.js",
    "revision": null
  }, {
    "url": "assets/pdf.worker.min-DI4FfYVf.js",
    "revision": null
  }, {
    "url": "assets/pdf-ULJPBbF3.js",
    "revision": null
  }, {
    "url": "assets/mukta-latin-700-normal-CI4CvK0O.woff2",
    "revision": null
  }, {
    "url": "assets/mukta-latin-600-normal-5TtPlXMC.woff2",
    "revision": null
  }, {
    "url": "assets/mukta-latin-500-normal-9gFvN3k4.woff2",
    "revision": null
  }, {
    "url": "assets/mukta-latin-400-normal-DXND9OdD.woff2",
    "revision": null
  }, {
    "url": "assets/index-RIYTqCLE.css",
    "revision": null
  }, {
    "url": "assets/index-Cd3NT4jc.js",
    "revision": null
  }, {
    "url": "assets/baloo-2-vietnamese-wght-normal-C4ZonJY6.woff2",
    "revision": null
  }, {
    "url": "assets/baloo-2-latin-wght-normal-B_TVFhwJ.woff2",
    "revision": null
  }, {
    "url": "assets/baloo-2-latin-ext-wght-normal-Dz43yst_.woff2",
    "revision": null
  }, {
    "url": "assets/baloo-2-devanagari-wght-normal-B4j4n2PV.woff2",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "ee5168d3b680fbfbd68389f4aa6267ca"
  }, {
    "url": "favicon.svg",
    "revision": "53d2ca48046fb3f366b0e176649551e1"
  }, {
    "url": "icon-192.png",
    "revision": "db7ab28c08abd651819a3a0f6a48c2a4"
  }, {
    "url": "icon-512.png",
    "revision": "3227b096989012ed1c81ea455349ed97"
  }, {
    "url": "icon-maskable-512.png",
    "revision": "23b2897e7bb41399eb475bbeb3d8bc08"
  }, {
    "url": "manifest.webmanifest",
    "revision": "5a22eb899940e7a450556a1ab76e357e"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("/leela/index.html"), {
    denylist: [/^\/rest\//, /^\/auth\//]
  }));

}));
