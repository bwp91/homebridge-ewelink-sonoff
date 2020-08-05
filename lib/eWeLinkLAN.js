/* jshint esversion: 9, -W030, node: true */
"use strict";
const axios = require("axios");
const constants = require("./constants");
const crypto = require("crypto");
const dns = require("node-dns-sd");
const eventemitter = require("events");
module.exports = class eWeLinkLAN {
   constructor(config, log, devices) {
      this.config = config;
      this.log = log;
      this.devices = devices;
      let deviceMap = {};
      devices.forEach(device => {
         deviceMap[device.deviceid] = {
            apiKey: device.devicekey,
            ip: false
         };
      });
      this.deviceMap = deviceMap;
      this.debug = this.config.debug || false;
      this.debugReqRes = this.config.debugReqRes || false;
      this.emitter = new eventemitter();
   }
   getHosts() {
      return new Promise((resolve, reject) => {
         dns.discover({
            name: "_ewelink._tcp.local"
         }).then(res => {
            res.forEach(device => {
               let a = device.fqdn.replace("._ewelink._tcp.local", "").replace("eWeLink_", "");
               if (this.deviceMap.hasOwnProperty(a)) {
                  this.deviceMap[a].ip = device.address;
               }
            });
            resolve(this.deviceMap);
         }).catch(err => {
            reject(err);
         });
      });
   }
   startMonitor() {
      dns.ondata = packet => {
         if (packet.answers) {
            packet.answers
               .filter(value => value.name.includes("_ewelink._tcp.local"))
               .forEach(value => {
                  if (value.type === "TXT") {
                     let rdata = value.rdata;
                     if (this.deviceMap.hasOwnProperty(rdata.id)) {
                        let deviceKey = this.deviceMap[rdata.id].apiKey;
                        let data = rdata.data1 +
                           (rdata.hasOwnProperty("data2") ? rdata.data2 : "") +
                           (rdata.hasOwnProperty("data3") ? rdata.data3 : "") +
                           (rdata.hasOwnProperty("data4") ? rdata.data4 : "");
                        let key = crypto.createHash("md5").update(Buffer.from(deviceKey, "utf8")).digest();
                        let dText = crypto.createDecipheriv("aes-128-cbc", key, Buffer.from(rdata.iv, "base64"));
                        let pText = Buffer.concat([dText.update(Buffer.from(data, "base64")), dText.final()]).toString("utf8");
                        let params;
                        try {
                           params = JSON.parse(pText);
                        } catch (e) {
                           this.log.warn("[%s] An error occured reading the LAN message [%s]", rdata.id, e);
                           return;
                        }
                        constants.paramsToRemove.forEach(prop => {
                           if (params.hasOwnProperty(prop)) {
                              delete params[prop];
                           }
                        });
                        if (Object.keys(params).length > 0) {
                           let returnTemplate = {
                              source: "lan",
                              deviceid: rdata.id,
                              action: "update",
                              params
                           };
                           if (this.debugReqRes) {
                              let msg = JSON.stringify(returnTemplate, null, 2).replace(rdata.id, "**hidden**");
                              this.log("LAN message received.\n%s", msg);
                           } else if (this.debug) {
                              this.log("LAN message received.");
                           }
                           this.emitter.emit("update", returnTemplate);
                        }
                     }
                  }
               });
         }
      };
      return new Promise((resolve, reject) => {
         dns.startMonitoring().then(() => {
            resolve();
         }).catch(err => {
            reject(err);
         });
      });
   }
   sendUpdate(json) {
      return new Promise((resolve, reject) => {
         if (!this.deviceMap[json.deviceid].ip) {
            throw "Device does not support LAN mode.";
         }
         let apiKey, suffix, params = {};
         if (json.params.hasOwnProperty("switches")) {
            params.switches = json.params.switches;
            suffix = "switches";
         } else if (json.params.hasOwnProperty("switch")) {
            params.switch = json.params.switch;
            suffix = "switch";
         }
         if ((apiKey = this.deviceMap[json.deviceid].apiKey)) {
            let key = crypto.createHash('md5').update(Buffer.from(apiKey, 'utf8')).digest();
            let iv = crypto.randomBytes(16);
            let enc = crypto.createCipheriv('aes-128-cbc', key, iv);
            let data = {
               data: Buffer.concat([enc.update(JSON.stringify(params)), enc.final()]).toString('base64'),
               deviceid: json.deviceid,
               encrypt: true,
               iv: iv.toString('base64'),
               selfApikey: "123",
               sequence: Date.now().toString()
            };
            if (this.debugReqRes) {
               let msg = JSON.stringify(json, null, 2).replace(json.apikey, "**hidden**").replace(json.apikey, "**hidden**").replace(json.deviceid, "**hidden**");
               this.log.warn("LAN mode message sent. This text is yellow for clarity.\n%s", msg);
            } else if (this.debug) {
               this.log("LAN mode message sent.");
            }
            axios({
               method: "post",
               url: "http://" + this.deviceMap[json.deviceid].ip + ":8081/zeroconf/" + suffix,
               headers: {
                  Accept: "application/json",
                  "Content-Type": "application/json;charset=UTF-8"
               },
               data: data
            }).then(res => {
               let body = res.data;
               if (body.hasOwnProperty("error") && body.error === 0) {
                  resolve();
               }
               throw body;
            }).catch(err => {
               reject(err);
            });
         }
      });
   }
   receiveUpdate(f) {
      this.emitter.addListener("update", f);
   }
};