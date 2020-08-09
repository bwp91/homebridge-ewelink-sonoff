/* jshint esversion: 9, -W030, node: true */
"use strict";
const constants = require("./constants");
const convert = require("color-convert");
const eWeLinkHTTP = require("./eWeLinkHTTP");
const eWeLinkWS = require("./eWeLinkWS");
const eWeLinkLAN = require("./eWeLinkLAN");
let Accessory, Service, Characteristic, UUIDGen;
class eWeLink {
   constructor(log, config, api) {
      if (!log || !api) {
         return;
      }
      if (!config || (!config.username || !config.password || !config.countryCode)) {
         log.error("** Could not load " + constants.packageName + " **");
         log.warn("Make sure your eWeLink credentials are in the Homebridge configuration.");
         return;
      }
      this.log = log;
      this.config = config;
      this.api = api;
      this.mode = this.config.mode || "lan";
      this.debug = this.config.debug || false;
      this.debugReqRes = this.config.debugReqRes || false;
      this.customHideChanFromHB = this.config.hideFromHB || "";
      this.customHideDvceFromHB = this.config.hideDevFromHB || "";
      this.sensorTimeLength = this.config.sensorTimeLength || 2;
      this.sensorTimeDifference = this.config.sensorTimeDifference || 120;
      this.devicesInHB = new Map();
      this.devicesInEwe = new Map();
      this.cusG = new Map();
      this.cusS = new Map();
      this.api.on("didFinishLaunching", () => {
         this.log("Plugin has finished initialising. Starting synchronisation with eWeLink account.");
         //*** Set up HTTP client and get the user HTTP host ***\\
         this.httpClient = new eWeLinkHTTP(this.config, this.log);
         this.httpClient.getHost()
            .then(res => { //*** Use the HTTP API host to log into eWeLink ***\\
               return this.httpClient.login();
            }).then(res => { //*** Set up the web socket client ***\\
               this.wsClient = new eWeLinkWS(this.config, this.log, res);
               return this.wsClient.getHost();
            }).then(res => { //*** Open web socket connection and get device list via HTTP ***\\
               this.wsClient.login();
               return this.httpClient.getDevices();
            }).then(res => { //*** Get device IP addresses for LAN mode ***\\
               this.httpDevices = res;
               this.lanClient = new eWeLinkLAN(this.config, this.log, this.httpDevices);
               return this.lanClient.getHosts();
            }).then(res => { //*** Set up the LAN mode listener ***\\
               this.lanDevices = res;
               return this.lanClient.startMonitor();
            }).then(res => { //*** Use the device list to refresh Homebridge accessories ***\\
               (() => {
                  //*** Remove all Homebridge accessories if none found ***\\
                  if (Object.keys(this.httpDevices).length === 0 && Object.keys(this.lanDevices).length === 0) {
                     this.removeAllAccessories();
                     return;
                  }
                  //*** Make a map of compatible devices from eWeLink ***\\
                  this.httpDevices.forEach(device => {
                     if (device.type !== "10" || this.customHideDvceFromHB.includes(device.deviceid)) {
                        return;
                     }
                     if (device.uiid === 2) this.log(device);
                     this.devicesInEwe.set(device.deviceid, device);
                  });
                  //*** Make a map of custom groups from Homebridge config ***\\
                  if (this.config.groups && Object.keys(this.config.groups).length > 0) {
                     this.config.groups.forEach(group => {
                        if (typeof group.deviceId !== "undefined" && this.devicesInEwe.has(group.deviceId.toLowerCase())) {
                           this.cusG.set(group.deviceId + "SWX", group);
                        }
                     });
                  }
                  //*** Make a map of RF Bridge custom sensors from Homebridge config ***\\
                  if (this.config.bridgeSensors && Object.keys(this.config.bridgeSensors).length > 0) {
                     this.config.bridgeSensors.forEach(bridgeSensor => {
                        if (typeof bridgeSensor.deviceId !== "undefined" && this.devicesInEwe.has(bridgeSensor.deviceId.toLowerCase())) {
                           this.cusS.set(bridgeSensor.fullDeviceId, bridgeSensor);
                        }
                     });
                  }
                  //*** Logging always helps to see if everything is okay so far ***\\
                  this.log("[%s] eWeLink devices were loaded from the Homebridge cache.", this.devicesInHB.size);
                  this.log("[%s] primary devices were loaded from your eWeLink account.", this.devicesInEwe.size);
                  this.log("[%s] primary devices were discovered on your local network.", Object.keys(this.lanDevices).length);
                  this.log("[%s] custom groups were loaded from the configuration.", this.cusG.size);
                  //*** Remove Homebridge accessories that don't appear in eWeLink ***\\
                  if (this.devicesInHB.size > 0) {
                     this.devicesInHB.forEach(accessory => {
                        if (!this.devicesInEwe.has(accessory.context.eweDeviceId)) {
                           this.removeAccessory(accessory);
                        }
                     });
                  }
                  //*** Disable plugin if no eWeLink devices ***\\
                  if (this.devicesInEwe.size === 0) {
                     return;
                  }
                  //*** Synchronise (add/refresh) devices between eWeLink and Homebridge ***\\
                  this.devicesInEwe.forEach(device => {
                     this.initialiseDevice(device);
                  });
                  //*** Set up the ws listener for future external device updates ***\\
                  this.wsClient.receiveUpdate(device => {
                     this.receiveDeviceUpdate(device);
                  });
                  //*** Set up the lan listener for future external device updates ***\\
                  this.lanClient.receiveUpdate(device => {
                     this.receiveDeviceUpdate(device);
                  });
                  this.log("Synchronisation complete. Ready to go!");
                  if (this.debugReqRes) {
                     this.log.warn("You have 'Request & Response Logging' enabled. This setting is not recommended for long-term use.");
                  }
               })();
            }).catch(err => {
               this.log.error("** eWeLink synchronisation error: **");
               this.log.warn(err);
               this.log.error("** Plugin will not be loaded. **");
            });
      });
   }
   initialiseDevice(device) {
      let accessory;
      //*** First add the device if it isn't already in Homebridge ***\\
      if (!this.devicesInHB.has(device.deviceid + "SWX") && !this.devicesInHB.has(device.deviceid + "SW0")) {
         if (device.uiid === 2 && device.brandName === "coolkit" && device.productModel === "0285") {
            this.addAccessory(device, device.deviceid + "SWX", "valve");
         } else if (this.cusG.has(device.deviceid + "SWX") && this.cusG.get(device.deviceid + "SWX").type === "blind") {
            this.addAccessory(device, device.deviceid + "SWX", "blind");
         } else if (this.cusG.has(device.deviceid + "SWX") && this.cusG.get(device.deviceid + "SWX").type === "garage") {
            this.addAccessory(device, device.deviceid + "SWX", "garage");
         } else if (constants.devicesSensor.includes(device.uiid)) {
            this.addAccessory(device, device.deviceid + "SWX", "sensor");
         } else if (constants.devicesFan.includes(device.uiid)) {
            this.addAccessory(device, device.deviceid + "SWX", "fan");
         } else if (constants.devicesThermostat.includes(device.uiid)) {
            this.addAccessory(device, device.deviceid + "SWX", "thermostat");
         } else if (constants.devicesOutlet.includes(device.uiid)) {
            this.addAccessory(device, device.deviceid + "SWX", "outlet");
         } else if (constants.devicesUSB.includes(device.uiid)) {
            this.addAccessory(device, device.deviceid + "SWX", "usb");
         } else if (constants.devicesSingleSwitch.includes(device.uiid) && constants.devicesSingleSwitchLight.includes(device.productModel)) {
            this.addAccessory(device, device.deviceid + "SWX", "light");
         } else if (constants.devicesMultiSwitch.includes(device.uiid) && constants.devicesMultiSwitchLight.includes(device.productModel)) {
            for (let i = 0; i <= constants.chansFromUiid[device.uiid]; i++) {
               this.addAccessory(device, device.deviceid + "SW" + i, "light");
            }
         } else if (constants.devicesSingleSwitch.includes(device.uiid)) {
            this.addAccessory(device, device.deviceid + "SWX", "switch");
         } else if (constants.devicesMultiSwitch.includes(device.uiid)) {
            for (let i = 0; i <= constants.chansFromUiid[device.uiid]; i++) {
               this.addAccessory(device, device.deviceid + "SW" + i, "switch");
            }
         } else if (constants.devicesBridge.includes(device.uiid)) {
            for (let i = 0; i <= Object.keys(device.params.rfList).length; i++) {
               this.addAccessory(device, device.deviceid + "SW" + i, "bridge");
            }
         } else {
            this.log.warn("[%s] could not be added as it is not supported by this plugin.", device.name);
         }
      }
      //*** Next refresh the device ***\\
      if ((accessory = this.devicesInHB.get(device.deviceid + "SWX"))) {
         accessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.FirmwareRevision, device.params.fwVersion);
         accessory.context.reachableWAN = accessory.context.eweUIID !== 102 ?
            device.online :
            true; //*** DW2 offline sometimes (as battery powered?) ***\\
         accessory.context.reachableLAN = this.lanDevices[device.deviceid].ip || false;
         let str = accessory.context.reachableLAN ?
            "and locally with IP [" + accessory.context.reachableLAN + "]" :
            (accessory.context.reachableWAN) ?
            "but LAN mode unavailable as unsupported" :
            "but LAN mode unavailable as device offline";
         this.log("[%s] found in eWeLink %s.", accessory.displayName, str);
         try {
            this.devicesInHB.set(accessory.context.hbDeviceId, accessory);
            this.api.updatePlatformAccessories(constants.packageName, "eWeLink", [accessory]);
         } catch (e) {
            this.log.warn("[%s] online/offline status could not be updated - [%s].", accessory.displayName, e);
         }
      } else if ((accessory = this.devicesInHB.get(device.deviceid + "SW0"))) {
         accessory.context.reachableLAN = this.lanDevices[device.deviceid].ip || false;
         let str = accessory.context.reachableLAN ?
            "and locally with IP [" + accessory.context.reachableLAN + "]" :
            (accessory.context.reachableWAN) ?
            "but LAN mode unavailable as unsupported" :
            "but LAN mode unavailable as device offline";
         this.log("[%s] found in eWeLink %s.", accessory.displayName, str);
         for (let i = 0; i <= accessory.context.channelCount; i++) {
            let oAccessory;
            try {
               if (!this.devicesInHB.has(device.deviceid + "SW" + i)) {
                  if (i > 0 && this.customHideChanFromHB.includes(device.deviceid + "SW" + i) && constants.devicesHideable.includes(accessory.context.type)) {
                     continue;
                  } else {
                     this.addAccessory(device, device.deviceid + "SW" + i, "switch");
                  }
               }
               oAccessory = this.devicesInHB.get(device.deviceid + "SW" + i);
               if (i > 0 && this.customHideChanFromHB.includes(device.deviceid + "SW" + i) && constants.devicesHideable.includes(accessory.context.type)) {
                  this.removeAccessory(oAccessory);
                  continue;
               }
               oAccessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.FirmwareRevision, device.params.fwVersion);
               oAccessory.context.reachableWAN = device.online;
               oAccessory.context.reachableLAN = this.lanDevices[device.deviceid].ip || false;
               this.devicesInHB.set(oAccessory.context.hbDeviceId, oAccessory);
               this.api.updatePlatformAccessories(constants.packageName, "eWeLink", [oAccessory]);
            } catch (e) {}
         }
      } else {
         this.log.warn("[%s] will not be refreshed as it wasn't found in Homebridge.", device.name);
         return;
      }
      if (!accessory.context.reachableWAN && !accessory.context.reachableLAN) {
         this.log.warn("[%s] will not be refreshed as it has been reported offline.", accessory.displayName);
         return;
      }
      if (!this.refreshAccessory(accessory, device.params)) {
         this.log.error("[%s] could not be refreshed due to missing type parameter. Please remove accessory from the Homebridge cache along with any secondary devices (SW1, SW2, etc.). Debugging: [%s:%s:%s]", accessory.displayName, "initialise", accessory.context.type, accessory.context.channelCount);
      }
   }
   addAccessory(device, hbDeviceId, type) {
      let channelCount = type === "bridge" ? Object.keys(device.params.rfList).length : constants.chansFromUiid[device.uiid];
      let switchNumber = hbDeviceId.substr(-1).toString();
      let newDeviceName = device.name;
      if (["1", "2", "3", "4"].includes(switchNumber)) {
         newDeviceName += " SW" + switchNumber;
         if (this.customHideChanFromHB.includes(hbDeviceId) && type === "switch") {
            this.log.warn("[%s] has not been added as per configuration", newDeviceName);
            return;
         }
      }
      const accessory = new Accessory(newDeviceName, UUIDGen.generate(hbDeviceId).toString());
      try {
         accessory.getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.SerialNumber, hbDeviceId)
            .setCharacteristic(Characteristic.Manufacturer, device.brandName)
            .setCharacteristic(Characteristic.Model, device.productModel + " (" + device.extra.extra.model + ")")
            .setCharacteristic(Characteristic.FirmwareRevision, device.params.fwVersion)
            .setCharacteristic(Characteristic.Identify, false);
         accessory.context = {
            hbDeviceId,
            eweDeviceId: device.deviceid,
            eweUIID: device.uiid,
            eweModel: device.productModel,
            eweApiKey: device.apikey,
            switchNumber,
            channelCount,
            type
         };
         switch (type) {
         case "valve":
            accessory.addService(Service.Valve, "Valve A", "valvea")
               .setCharacteristic(Characteristic.Active, 0)
               .setCharacteristic(Characteristic.InUse, 0)
               .setCharacteristic(Characteristic.ValveType, 1);
            accessory.addService(Service.Valve, "Valve B", "valveb")
               .setCharacteristic(Characteristic.Active, 0)
               .setCharacteristic(Characteristic.InUse, 0)
               .setCharacteristic(Characteristic.ValveType, 1);
            break;
         case "blind":
            accessory.addService(Service.WindowCovering)
               .setCharacteristic(Characteristic.CurrentPosition, 100)
               .setCharacteristic(Characteristic.TargetPosition, 100)
               .setCharacteristic(Characteristic.PositionState, 2);
            break;
         case "garage":
            accessory.addService(Service.GarageDoorOpener)
               .setCharacteristic(Characteristic.CurrentDoorState, 1)
               .setCharacteristic(Characteristic.TargetDoorState, 1)
               .setCharacteristic(Characteristic.ObstructionDetected, false);
            break;
         case "sensor":
            accessory.addService(Service.ContactSensor)
               .setCharacteristic(Characteristic.ContactSensorState, 0);
            break;
         case "fan":
            accessory.addService(Service.Fanv2);
            accessory.addService(Service.Lightbulb);
            break;
         case "thermostat":
            accessory.addService(Service.Switch);
            accessory.addService(Service.TemperatureSensor);
            if (device.params.sensorType !== "DS18B20") {
               accessory.addService(Service.HumiditySensor);
            }
            break;
         case "outlet":
         case "usb":
            accessory.addService(Service.Outlet);
            break;
         case "light":
            accessory.addService(Service.Lightbulb);
            break;
         case "switch":
            accessory.addService(Service.Switch);
            break;
         case "bridge":
            accessory.context.sensorType = this.cusS.has(hbDeviceId) ? this.cusS.get(hbDeviceId).type : "motion";
            switch (accessory.context.sensorType) {
            case "water":
               accessory.addService(Service.LeakSensor);
               break;
            case "fire":
            case "smoke":
               accessory.addService(Service.SmokeSensor);
               break;
            case "co":
               accessory.addService(Service.CarbonMonoxideSensor);
               break;
            case "co2":
               accessory.addService(Service.CarbonDioxideSensor);
               break;
            case "contact":
               accessory.addService(Service.ContactSensor);
               break;
            case "occupancy":
               accessory.addService(Service.OccupancySensor);
               break;
            case "motion":
            default:
               accessory.addService(Service.MotionSensor);
               break;
            }
            break;
         default:
            throw "Device not supported by this plugin.";
         }
         this.devicesInHB.set(hbDeviceId, accessory);
         this.api.registerPlatformAccessories(constants.packageName, "eWeLink", [accessory]);
         this.configureAccessory(accessory);
         this.log("[%s] has been added to Homebridge.", newDeviceName);
      } catch (e) {
         this.log.warn("[%s] could not be added - [%s].", accessory.displayName, e);
      }
   }
   configureAccessory(accessory) {
      if (!this.log) {
         return;
      }
      try {
         switch (accessory.context.type) {
         case "valve":
            accessory.getService("Valve A").getCharacteristic(Characteristic.Active)
               .on("set", (value, callback) => {
                  accessory.getService("Valve A").getCharacteristic(Characteristic.Active).value !== value ?
                     this.internalValveUpdate(accessory, "Valve A", value, callback) :
                     callback();
               });
            accessory.getService("Valve B").getCharacteristic(Characteristic.Active)
               .on("set", (value, callback) => {
                  accessory.getService("Valve B").getCharacteristic(Characteristic.Active).value !== value ?
                     this.internalValveUpdate(accessory, "Valve B", value, callback) :
                     callback();
               });
            break;
         case "blind":
            accessory.getService(Service.WindowCovering).getCharacteristic(Characteristic.TargetPosition)
               .setProps({
                  minStep: 100
               })
               .on("set", (value, callback) => {
                  accessory.getService(Service.WindowCovering).getCharacteristic(Characteristic.TargetPosition).value !== value ?
                     this.internalBlindUpdate(accessory, value, callback) :
                     callback();
               });
            break;
         case "garage":
            accessory.getService(Service.GarageDoorOpener).getCharacteristic(Characteristic.TargetDoorState)
               .on("set", (value, callback) => {
                  accessory.getService(Service.GarageDoorOpener).getCharacteristic(Characteristic.TargetDoorState).value !== value ?
                     this.internalGarageUpdate(accessory, value, callback) :
                     callback();
               });
            break;
         case "fan":
            accessory.getService(Service.Fanv2).getCharacteristic(Characteristic.Active)
               .on("set", (value, callback) => {
                  accessory.getService(Service.Fanv2).getCharacteristic(Characteristic.Active).value !== value ?
                     this.internalFanUpdate(accessory, "power", value, callback) :
                     callback();
               });
            accessory.getService(Service.Fanv2).getCharacteristic(Characteristic.RotationSpeed)
               .setProps({
                  minStep: 33
               })
               .on("set", (value, callback) => {
                  accessory.getService(Service.Fanv2).getCharacteristic(Characteristic.RotationSpeed).value !== value ?
                     this.internalFanUpdate(accessory, "speed", value, callback) :
                     callback();
               });
            accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On)
               .on("set", (value, callback) => {
                  accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).value !== value ?
                     this.internalFanUpdate(accessory, "light", value, callback) :
                     callback();
               });
            break;
         case "thermostat":
            accessory.getService(Service.Switch).getCharacteristic(Characteristic.On)
               .on("set", (value, callback) => {
                  accessory.getService(Service.Switch).getCharacteristic(Characteristic.On).value !== value ?
                     this.internalThermostatUpdate(accessory, value, callback) :
                     callback();
               });
            break;
         case "outlet":
            accessory.getService(Service.Outlet).getCharacteristic(Characteristic.On)
               .on("set", (value, callback) => {
                  accessory.getService(Service.Outlet).getCharacteristic(Characteristic.On).value !== value ?
                     this.internalOutletUpdate(accessory, value, callback) :
                     callback();
               });
            break;
         case "usb":
            accessory.getService(Service.Outlet).getCharacteristic(Characteristic.On)
               .on("set", (value, callback) => {
                  accessory.getService(Service.Outlet).getCharacteristic(Characteristic.On).value !== value ?
                     this.internalUSBUpdate(accessory, value, callback) :
                     callback();
               });
            break;
         case "light":
            accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On)
               .on("set", (value, callback) => {
                  accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).value !== value ?
                     this.internalLightbulbUpdate(accessory, value, callback) :
                     callback();
               });
            if (constants.devicesBrightable.includes(accessory.context.eweUIID)) {
               accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Brightness)
                  .on("set", (value, callback) => {
                     if (value > 0) {
                        if (!accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).value) {
                           this.internalLightbulbUpdate(accessory, true, callback);
                        }
                        accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Brightness).value !== value ?
                           this.internalBrightnessUpdate(accessory, value, callback) :
                           callback();
                     } else {
                        accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).value ?
                           this.internalLightbulbUpdate(accessory, false, callback) :
                           callback();
                     }
                  });
            } else if (constants.devicesColourable.includes(accessory.context.eweUIID)) {
               accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Brightness)
                  .on("set", (value, callback) => {
                     if (value > 0) {
                        if (!accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).value) {
                           this.internalLightbulbUpdate(accessory, true, callback);
                        }
                        accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Brightness).value !== value ?
                           this.internalHSBUpdate(accessory, "bri", value, callback) :
                           callback();
                     } else {
                        accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).value ?
                           this.internalLightbulbUpdate(accessory, false, callback) :
                           callback();
                     }
                  });
               accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Hue)
                  .on("set", (value, callback) => {
                     accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Hue).value !== value ?
                        this.internalHSBUpdate(accessory, "hue", value, callback) :
                        callback();
                  });
               accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Saturation)
                  .on("set", (value, callback) => {
                     accessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.Saturation, value);
                     callback();
                  });
            }
            break;
         case "switch":
            accessory.getService(Service.Switch).getCharacteristic(Characteristic.On)
               .on("set", (value, callback) => {
                  accessory.getService(Service.Switch).getCharacteristic(Characteristic.On).value !== value ?
                     this.internalSwitchUpdate(accessory, value, callback) :
                     callback();
               });
            break;
         }
         accessory.context.reachableWAN = true;
         accessory.context.reachableLAN = true;
         this.devicesInHB.set(accessory.context.hbDeviceId, accessory);
         this.api.updatePlatformAccessories(constants.packageName, "eWeLink", [accessory]);
      } catch (e) {
         this.log.warn("[%s] could not be refreshed - [%s].", accessory.displayName, e);
      }
   }
   refreshAccessory(accessory, newParams) {
      switch (accessory.context.type) {
      case "valve":
         if (Array.isArray(newParams.switches)) {
            this.externalValveUpdate(accessory, newParams);
         }
         return true;
      case "blind":
         if (Array.isArray(newParams.switches)) {
            this.externalBlindUpdate(accessory, newParams);
         }
         return true;
      case "garage":
         if (newParams.hasOwnProperty("switch") || Array.isArray(newParams.switches)) {
            this.externalGarageUpdate(accessory, newParams);
         }
         return true;
      case "sensor":
         if (newParams.hasOwnProperty("switch")) {
            this.externalSensorUpdate(accessory, newParams);
         }
         return true;
      case "fan":
         if (Array.isArray(newParams.switches) || (newParams.hasOwnProperty("light") && newParams.hasOwnProperty("fan") && newParams.hasOwnProperty("speed"))) {
            this.externalFanUpdate(accessory, newParams);
         }
         return true;
      case "thermostat":
         if (newParams.hasOwnProperty("currentTemperature") || newParams.hasOwnProperty("currentHumidity") || newParams.hasOwnProperty("switch") || newParams.hasOwnProperty("masterSwitch")) {
            this.externalThermostatUpdate(accessory, newParams);
         }
         return true;
      case "outlet":
         if (newParams.hasOwnProperty("switch")) {
            this.externalOutletUpdate(accessory, newParams);
         }
         return true;
      case "usb":
         if (Array.isArray(newParams.switches)) {
            this.externalUSBUpdate(accessory, newParams);
         }
         return true;
      case "light":
         if (constants.devicesSingleSwitch.includes(accessory.context.eweUIID) && constants.devicesSingleSwitchLight.includes(accessory.context.eweModel)) {
            if (newParams.hasOwnProperty("switch") || newParams.hasOwnProperty("state") || newParams.hasOwnProperty("bright") || newParams.hasOwnProperty("colorR") || newParams.hasOwnProperty("brightness") || newParams.hasOwnProperty("channel0") || newParams.hasOwnProperty("channel2") || newParams.hasOwnProperty("zyx_mode")) {
               this.externalSingleLightUpdate(accessory, newParams);
            }
         } else if (constants.devicesMultiSwitch.includes(accessory.context.eweUIID) && constants.devicesMultiSwitchLight.includes(accessory.context.eweModel)) {
            if (Array.isArray(newParams.switches)) {
               this.externalMultiLightUpdate(accessory, newParams);
            }
         }
         return true;
      case "switch":
         if (constants.devicesSingleSwitch.includes(accessory.context.eweUIID)) {
            if (newParams.hasOwnProperty("switch")) {
               this.externalSingleSwitchUpdate(accessory, newParams);
            }
         } else if (constants.devicesMultiSwitch.includes(accessory.context.eweUIID)) {
            if (Array.isArray(newParams.switches)) {
               this.externalMultiSwitchUpdate(accessory, newParams);
            }
         }
         return true;
      case "bridge":
         this.externalBridgeUpdate(accessory, newParams);
         return true;
      default:
         return false;
      }
   }
   removeAccessory(accessory) {
      try {
         this.devicesInHB.delete(accessory.context.hbDeviceId);
         this.api.unregisterPlatformAccessories(constants.packageName, "eWeLink", [accessory]);
         this.log("[%s] will be removed from Homebridge.", accessory.displayName);
      } catch (e) {
         this.log.warn("[%s] needed to be removed but couldn't - [%s].", accessory.displayName, e);
      }
   }
   removeAllAccessories() {
      try {
         this.log.warn("[0] primary devices were loaded from your eWeLink account so any eWeLink devices in the Homebridge cache will be removed. This plugin will not load as there is no reason to continue.");
         this.api.unregisterPlatformAccessories(constants.packageName, "eWeLink", Array.from(this.devicesInHB.values()));
         this.devicesInHB.clear();
      } catch (e) {
         this.log.warn("Accessories could not be removed from the Homebridge cache - [%s].", e);
      }
   }
   sendDeviceUpdate(accessory, params, callback) {
      let payload = {
         apikey: accessory.context.eweApiKey,
         selfApikey: accessory.context.eweApiKey,
         deviceid: accessory.context.eweDeviceId,
         params
      };
      switch (this.mode) {
      case "ws":
         this.wsClient.sendUpdate(payload, callback);
         setTimeout(() => {
            this.wsClient.requestUpdate(accessory);
         }, 2500);
         break;
      case "lan":
      default:
         this.lanClient.sendUpdate(payload)
            .then(res => {
               callback();
            })
            .catch(err => {
               if (accessory.context.reachableWAN) {
                  if (this.debug) {
                     this.log.warn("[%s] LAN update failed as %s. Trying web socket update.", accessory.displayName, err);
                  }
                  this.wsClient.sendUpdate(payload, callback);
                  setTimeout(() => {
                     this.wsClient.requestUpdate(accessory);
                  }, 2500);
               } else {
                  this.log.error("[%s] could not be updated as it appears to be offline.", accessory.displayName);
                  callback("Device has failed to update");
               }
            });
      }
   }
   receiveDeviceUpdate(device) {
      let accessory;
      switch (device.action) {
      case "sysmsg":
         if (this.devicesInHB.has(device.deviceid + "SWX") || this.devicesInHB.has(device.deviceid + "SW0")) {
            accessory = this.devicesInHB.get(device.deviceid + "SWX") || this.devicesInHB.get(device.deviceid + "SW0");
            try {
               if (accessory.context.reachableWAN !== device.params.online) {
                  accessory.context.reachableWAN = device.params.online;
                  this.log("[%s] has been reported [%s].", accessory.displayName, accessory.context.reachableWAN ? "online" : "offline");
                  this.devicesInHB.set(accessory.context.hbDeviceId, accessory);
                  this.api.updatePlatformAccessories(constants.packageName, "eWeLink", [accessory]);
                  if (accessory.context.reachableWAN) {
                     this.wsClient.requestUpdate(accessory);
                  }
               }
            } catch (e) {
               this.log.warn("[%s] online/offline status could not be updated - [%s].", accessory.displayName, e);
            }
            if (this.devicesInHB.has(device.deviceid + "SW0")) {
               let oAccessory;
               for (let i = 1; i <= accessory.context.channelCount; i++) {
                  try {
                     if (this.devicesInHB.has(device.deviceid + "SW" + i)) {
                        oAccessory = this.devicesInHB.get(device.deviceid + "SW" + i);
                        oAccessory.context.reachableWAN = device.params.online;
                        this.devicesInHB.set(oAccessory.context.hbDeviceId, oAccessory);
                        this.api.updatePlatformAccessories(constants.packageName, "eWeLink", [oAccessory]);
                     }
                  } catch (e) {
                     this.log.warn("[%s] online/offline status could not be updated - [%s].", oAccessory.displayName, e);
                  }
               }
            }
         }
         break;
      case "update":
         let source = device.source === "ws" ? "WS" : "LAN";
         if (this.devicesInHB.has(device.deviceid + "SWX") || this.devicesInHB.has(device.deviceid + "SW0")) {
            accessory = this.devicesInHB.get(device.deviceid + "SWX") || this.devicesInHB.get(device.deviceid + "SW0");
            if (!accessory.context.reachableWAN && !accessory.context.reachableLAN) {
               this.log.warn("[%s] will not be refreshed as it has been reported offline.", accessory.displayName);
               return;
            }
            if (this.debug) {
               this.log("[%s] externally updated from above %s message and will be refreshed.", accessory.displayName, source);
            }
            if (this.refreshAccessory(accessory, device.params)) {
               return;
            }
            this.log.error("[%s] cannot be refreshed due to missing type parameter. Please remove accessory from the Homebridge cache along with any secondary devices (SW1, SW2, etc.). Debugging: [%s:%s:%s]", accessory.displayName, "refresh", accessory.context.type, accessory.context.channelCount);
         } else if (this.customHideDvceFromHB.includes(device.deviceid)) {
            this.log.warn("[%s] %s update is for hidden accessory.", device.deviceid, source);
         } else {
            this.log.warn("[%s] Accessory received via %s update does not exist in Homebridge. If it's a new accessory please restart Homebridge so it is added.", device.deviceid, source);
         }
         break;
      }
   }
   internalValveUpdate(accessory, valve, value, callback) {
      try {
         if (!accessory.context.reachableWAN && !accessory.context.reachableLAN) {
            throw "it is currently offline";
         }
         let params = {};
         accessory.getService(valve)
            .updateCharacteristic(Characteristic.Active, value)
            .updateCharacteristic(Characteristic.InUse, value);
         params.switches = this.devicesInEwe.get(accessory.context.eweDeviceId).params.switches;
         switch (valve) {
         case "Valve A":
            params.switches[0].switch = value ? "on" : "off";
            params.switches[1].switch = accessory.getService("Valve B").getCharacteristic(Characteristic.Active).value ? "on" : "off";
            break;
         case "Valve B":
            params.switches[0].switch = accessory.getService("Valve A").getCharacteristic(Characteristic.Active).value ? "on" : "off";
            params.switches[1].switch = value ? "on" : "off";
            break;
         default:
            throw "unknown valve [" + valve + "]";
         }
         params.switches[2].switch = "off";
         params.switches[3].switch = "off";
         this.sendDeviceUpdate(accessory, params, callback);
      } catch (err) {
         let str = "[" + accessory.displayName + "] could not be updated as " + err + ".";
         this.log.error(str);
         callback(str);
      }
   }
   internalBlindUpdate(accessory, value, callback) {
      try {
         if (!accessory.context.reachableWAN && !accessory.context.reachableLAN) {
            throw "it is currently offline";
         }
         let blindConfig, params = {};
         if (!(blindConfig = this.cusG.get(accessory.context.hbDeviceId))) {
            throw "group config missing";
         }
         if (blindConfig.type !== "blind" || blindConfig.setup !== "twoSwitch") {
            throw "improper configuration";
         }
         value = value >= 50 ? 100 : 0;
         params.switches = this.devicesInEwe.get(accessory.context.eweDeviceId).params.switches;
         params.switches[0].switch = value === 100 ? "on" : "off";
         params.switches[1].switch = value === 0 ? "on" : "off";
         this.log("[%s] updating target position to [%s%].", accessory.displayName, value);
         this.sendDeviceUpdate(accessory, params, function () {
            return;
         });
         accessory.getService(Service.WindowCovering)
            .updateCharacteristic(Characteristic.TargetPosition, value)
            .updateCharacteristic(Characteristic.PositionState, (value / 100));
         if (!blindConfig.inched || blindConfig.inched === "false") {
            setTimeout(() => {
               params.switches[0].switch = "off";
               params.switches[1].switch = "off";
               this.sendDeviceUpdate(accessory, params, function () {
                  return;
               });
            }, 500);
         } else {
            if (this.debug) {
               this.log("[%s] not sending off command as inched through eWeLink.", accessory.displayName);
            }
         }
         setTimeout(() => {
            accessory.getService(Service.WindowCovering)
               .updateCharacteristic(Characteristic.CurrentPosition, value)
               .updateCharacteristic(Characteristic.PositionState, 2);
            callback();
         }, blindConfig.operationTime * 100);
      } catch (err) {
         let str = "[" + accessory.displayName + "] could not be updated as " + err + ".";
         this.log.error(str);
         callback(str);
      }
   }
   internalGarageUpdate(accessory, value, callback) {
      try {
         this.log.warn("internalGarageUpdate() with value [%s]", value);
         if (!accessory.context.reachableWAN && !accessory.context.reachableLAN) {
            throw "it is currently offline";
         }
         let garageConfig, params = {};
         if (!(garageConfig = this.cusG.get(accessory.context.hbDeviceId))) {
            throw "group config missing";
         }
         if (garageConfig.type !== "garage" || !["oneSwitch", "twoSwitch"].includes(garageConfig.setup)) {
            throw "improper configuration";
         }
         let sensorDefinition = garageConfig.sensorId || false;
         let sAccessory = false;
         if (sensorDefinition && !(sAccessory = this.devicesInHB.get(garageConfig.sensorId + "SWX"))) {
            throw "defined sensor doesn't exist";
         }
         this.log("[%s] has received request to [%s].", accessory.displayName, value === 0 ? "open" : "close");
         if (garageConfig.setup === "twoSwitch") {
            params.switches = this.devicesInEwe.get(accessory.context.eweDeviceId).params.switches;
            params.switches[0].switch = value === 0 ? "on" : "off";
            params.switches[1].switch = value === 1 ? "on" : "off";
         } else {
            params.switch = "on";
            let pSte;
            if (sAccessory) {
               pSte = sAccessory.getService(Service.ContactSensor).getCharacteristic(Characteristic.ContactSensorState).value === 0 ? 1 : 0;
               this.log("[%s] reports that [%s] is [%s].", sAccessory.displayName, accessory.displayName, pSte ? "open" : "closed");
            } else {
               pSte = accessory.getService(Service.GarageDoorOpener).getCharacteristic(Characteristic.CurrentDoorState).value;
               pSte = [0, 2].includes(pSte) ? 0 : 1;
            }
            
            if (value === pSte) {
               accessory.getService(Service.GarageDoorOpener)
                  .updateCharacteristic(Characteristic.TargetDoorState, value)
                  .updateCharacteristic(Characteristic.CurrentDoorState, value);
               callback();
               return;
            }
         }
         this.sendDeviceUpdate(accessory, params, function () {
            return;
         });
         accessory.getService(Service.GarageDoorOpener)
            .updateCharacteristic(Characteristic.TargetDoorState, value === 0 ? 0 : 1)
            .updateCharacteristic(Characteristic.CurrentDoorState, value === 0 ? 2 : 3);
         if (!garageConfig.inched || garageConfig.inched === "false") {
            setTimeout(() => {
               params.switch = "off";
               this.sendDeviceUpdate(accessory, params, function () {
                  return;
               });
            }, 500);
         }
         if (!sAccessory) {
            setTimeout(() => {
               accessory.getService(Service.GarageDoorOpener)
                  .updateCharacteristic(Characteristic.CurrentDoorState, value === 0 ? 0 : 1);
               callback();
            }, parseInt(garageConfig.operationTime) * 100);
         } else {
            callback();
         }
      } catch (err) {
         let str = "[" + accessory.displayName + "] could not be updated as " + err + ".";
         this.log.error(str);
         callback(str);
      }
   }
   internalFanUpdate(accessory, type, value, callback) {
      try {
         if (!accessory.context.reachableWAN && !accessory.context.reachableLAN) {
            throw "it is currently offline";
         }
         let newPower, newSpeed, newLight, wsDelay;
         switch (type) {
         case "power":
            newPower = value;
            newSpeed = 33;
            newLight = accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).value;
            wsDelay = 0;
            break;
         case "speed":
            newPower = value >= 33 ? 1 : 0;
            newSpeed = value;
            newLight = accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).value;
            wsDelay = 250;
            break;
         case "light":
            newPower = accessory.getService(Service.Fanv2).getCharacteristic(Characteristic.Active).value;
            newSpeed = accessory.getService(Service.Fanv2).getCharacteristic(Characteristic.RotationSpeed).value;
            newLight = value;
            wsDelay = 0;
            break;
         }
         let params = {
            switches: this.devicesInEwe.get(accessory.context.eweDeviceId).params.switches
         };
         params.switches[0].switch = newLight ? "on" : "off";
         params.switches[1].switch = (newPower === 1 && newSpeed >= 33) ? "on" : "off";
         params.switches[2].switch = (newPower === 1 && newSpeed >= 66 && newSpeed < 99) ? "on" : "off";
         params.switches[3].switch = (newPower === 1 && newSpeed >= 99) ? "on" : "off";
         if (this.debug) {
            this.log("[%s] updating power [%s], speed [%s%], light [%s].", accessory.displayName, newPower, newSpeed, newLight);
         }
         accessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.On, newLight);
         accessory.getService(Service.Fanv2)
            .updateCharacteristic(Characteristic.Active, newPower)
            .updateCharacteristic(Characteristic.RotationSpeed, newSpeed);
         setTimeout(() => {
            this.sendDeviceUpdate(accessory, params, callback);
         }, wsDelay);
      } catch (err) {
         let str = "[" + accessory.displayName + "] could not be updated as " + err + ".";
         this.log.error(str);
         callback(str);
      }
   }
   internalThermostatUpdate(accessory, value, callback) {
      try {
         if (!accessory.context.reachableWAN && !accessory.context.reachableLAN) {
            throw "it is currently offline";
         }
         let params = {
            switch: value ? "on" : "off",
            mainSwitch: value ? "on" : "off"
         };
         if (this.debug) {
            this.log("[%s] updating to turn [%s].", accessory.displayName, value ? "on" : "off");
         }
         accessory.getService(Service.Switch).updateCharacteristic(Characteristic.On, value);
         this.sendDeviceUpdate(accessory, params, callback);
      } catch (err) {
         let str = "[" + accessory.displayName + "] could not be updated as " + err + ".";
         this.log.error(str);
         callback(str);
      }
   }
   internalOutletUpdate(accessory, value, callback) {
      try {
         if (!accessory.context.reachableWAN && !accessory.context.reachableLAN) {
            throw "it is currently offline";
         }
         let params = {
            switch: value ? "on" : "off"
         };
         if (this.debug) {
            this.log("[%s] requesting to turn [%s].", accessory.displayName, value ? "on" : "off");
         }
         accessory.getService(Service.Outlet).updateCharacteristic(Characteristic.On, value);
         this.sendDeviceUpdate(accessory, params, callback);
      } catch (err) {
         callback("[" + accessory.displayName + "] " + err + ".");
      }
   }
   internalUSBUpdate(accessory, value, callback) {
      try {
         if (!accessory.context.reachableWAN && !accessory.context.reachableLAN) {
            throw "it is currently offline";
         }
         let params = {
            switches: this.devicesInEwe.get(accessory.context.eweDeviceId).params.switches
         };
         params.switches[0].switch = value ? "on" : "off";
         if (this.debug) {
            this.log("[%s] requesting to turn [%s].", accessory.displayName, value ? "on" : "off");
         }
         accessory.getService(Service.Outlet).updateCharacteristic(Characteristic.On, value);
         this.sendDeviceUpdate(accessory, params, callback);
      } catch (err) {
         callback("[" + accessory.displayName + "] " + err + ".");
      }
   }
   internalLightbulbUpdate(accessory, value, callback) {
      try {
         if (!accessory.context.reachableWAN && !accessory.context.reachableLAN) {
            throw "it is currently offline";
         }
         let oAccessory, params = {};
         switch (accessory.context.switchNumber) {
         case "X":
            if (accessory.context.eweUIID === 22) { //*** B1 ***\\
               params.state = value ? "on" : "off";
            } else {
               params.switch = value ? "on" : "off";
            }
            if (this.debug) {
               this.log("[%s] updating to turn [%s].", accessory.displayName, value ? "on" : "off");
            }
            accessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.On, value);
            break;
         case "0":
            params.switches = this.devicesInEwe.get(accessory.context.eweDeviceId).params.switches;
            params.switches[0].switch = value ? "on" : "off";
            params.switches[1].switch = value ? "on" : "off";
            params.switches[2].switch = value ? "on" : "off";
            params.switches[3].switch = value ? "on" : "off";
            if (this.debug) {
               this.log("[%s] updating to turn group [%s].", accessory.displayName, value ? "on" : "off");
            }
            accessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.On, value);
            for (let i = 1; i <= 4; i++) {
               if (this.devicesInHB.has(accessory.context.eweDeviceId + "SW" + i)) {
                  oAccessory = this.devicesInHB.get(accessory.context.eweDeviceId + "SW" + i);
                  oAccessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.On, value);
               }
            }
            break;
         case "1":
         case "2":
         case "3":
         case "4":
            if (this.debug) {
               this.log("[%s] updating to turn [%s].", accessory.displayName, value ? "on" : "off");
            }
            accessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.On, value);
            let tAccessory;
            let masterState = "off";
            params.switches = this.devicesInEwe.get(accessory.context.eweDeviceId).params.switches;
            for (let i = 1; i <= 4; i++) {
               if ((tAccessory = this.devicesInHB.get(accessory.context.eweDeviceId + "SW" + i))) {
                  i === parseInt(accessory.context.switchNumber) ?
                     params.switches[i - 1].switch = value ? "on" : "off" :
                     params.switches[i - 1].switch = tAccessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).value ? "on" : "off";
                  if (tAccessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).value) {
                     masterState = "on";
                  }
               } else {
                  params.switches[i - 1].switch = "off";
               }
            }
            oAccessory = this.devicesInHB.get(accessory.context.eweDeviceId + "SW0");
            oAccessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.On, masterState === "on");
            break;
         default:
            throw "unknown switch number [" + accessory.context.switchNumber + "]";
         }
         this.sendDeviceUpdate(accessory, params, callback);
      } catch (err) {
         let str = "[" + accessory.displayName + "] could not be updated as " + err + ".";
         this.log.error(str);
         callback(str);
      }
   }
   internalBrightnessUpdate(accessory, value, callback) {
      try {
         if (!accessory.context.reachableWAN && !accessory.context.reachableLAN) {
            throw "it is currently offline";
         }
         let params = {};
         if (value === 0) {
            params.switch = "off";
            accessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.On, false);
         } else {
            if (!accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).value) {
               params.switch = "on";
            }
            switch (accessory.context.eweUIID) {
            case 36: //*** KING-M4 ***\\
               params.bright = Math.round(value * 9 / 10 + 10);
               break;
            case 44: //*** D1 ***\\
               params.brightness = value;
               params.mode = 0;
               break;
            default:
               throw "unknown device UIID";
            }
            accessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.Brightness, value);
         }
         if (this.debug) {
            this.log("[%s] updating brightness to [%s%].", accessory.displayName, value);
         }
         setTimeout(() => {
            this.sendDeviceUpdate(accessory, params, callback);
         }, 250);
      } catch (err) {
         let str = "[" + accessory.displayName + "] could not be updated as " + err + ".";
         this.log.error(str);
         callback(str);
      }
   }
   internalHSBUpdate(accessory, type, value, callback) {
      try {
         if (!accessory.context.reachableWAN && !accessory.context.reachableLAN) {
            throw "it is currently offline";
         }
         let newRGB, params = {};
         let curHue = accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Hue).value;
         let curSat = accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.Saturation).value;
         switch (type) {
         case "hue":
            newRGB = convert.hsv.rgb(value, curSat, 100);
            switch (accessory.context.eweUIID) {
            case 22: //*** B1 ***\\
               params = {
                  zyx_mode: 2,
                  type: "middle",
                  channel0: "0",
                  channel1: "0",
                  channel2: newRGB[0].toString(),
                  channel3: newRGB[1].toString(),
                  channel4: newRGB[2].toString()
               };
               break;
            case 59: //*** L1 ***\\
               params = {
                  mode: 1,
                  colorR: newRGB[0],
                  colorG: newRGB[1],
                  colorB: newRGB[2]
               };
               break;
            default:
               throw "unknown device UIID";
            }
            if (this.debug) {
               this.log("[%s] updating hue to [%s°].", accessory.displayName, value);
            }
            accessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.Hue, value);
            break;
         case "bri":
            switch (accessory.context.eweUIID) {
            case 22: //*** B1 ***\\
               newRGB = convert.hsv.rgb(curHue, curSat, value);
               params = {
                  zyx_mode: 2,
                  type: "middle",
                  channel0: "0",
                  channel1: "0",
                  channel2: newRGB[0].toString(),
                  channel3: newRGB[1].toString(),
                  channel4: newRGB[2].toString()
               };
               break;
            case 59: //*** L1 ***\\
               params = {
                  mode: 1,
                  bright: value
               };
               break;
            }
            if (this.debug) {
               this.log("[%s] updating brightness to [%s%].", accessory.displayName, value);
            }
            accessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.Brightness, value);
            break;
         default:
            throw "unknown device UIID";
         }
         setTimeout(() => {
            this.sendDeviceUpdate(accessory, params, callback);
         }, 250);
      } catch (err) {
         let str = "[" + accessory.displayName + "] could not be updated as " + err + ".";
         this.log.error(str);
         callback(str);
      }
   }
   internalSwitchUpdate(accessory, value, callback) {
      try {
         if (!accessory.context.reachableWAN && !accessory.context.reachableLAN) {
            throw "it is currently offline";
         }
         let oAccessory, params = {};
         switch (accessory.context.switchNumber) {
         case "X":
            params.switch = value ? "on" : "off";
            if (this.debug) {
               this.log("[%s] updating to turn [%s].", accessory.displayName, value ? "on" : "off");
            }
            accessory.getService(Service.Switch).updateCharacteristic(Characteristic.On, value);
            break;
         case "0":
            params.switches = this.devicesInEwe.get(accessory.context.eweDeviceId).params.switches;
            params.switches[0].switch = value ? "on" : "off";
            params.switches[1].switch = value ? "on" : "off";
            params.switches[2].switch = value ? "on" : "off";
            params.switches[3].switch = value ? "on" : "off";
            if (this.debug) {
               this.log("[%s] updating to turn group [%s].", accessory.displayName, value ? "on" : "off");
            }
            accessory.getService(Service.Switch).updateCharacteristic(Characteristic.On, value);
            for (let i = 1; i <= 4; i++) {
               if (this.devicesInHB.has(accessory.context.eweDeviceId + "SW" + i)) {
                  oAccessory = this.devicesInHB.get(accessory.context.eweDeviceId + "SW" + i);
                  oAccessory.getService(Service.Switch).updateCharacteristic(Characteristic.On, value);
               }
            }
            break;
         case "1":
         case "2":
         case "3":
         case "4":
            if (this.debug) {
               this.log("[%s] updating to turn [%s].", accessory.displayName, value ? "on" : "off");
            }
            accessory.getService(Service.Switch).updateCharacteristic(Characteristic.On, value);
            let tAccessory;
            let masterState = "off";
            params.switches = this.devicesInEwe.get(accessory.context.eweDeviceId).params.switches;
            for (let i = 1; i <= 4; i++) {
               if ((tAccessory = this.devicesInHB.get(accessory.context.eweDeviceId + "SW" + i))) {
                  i === parseInt(accessory.context.switchNumber) ?
                     params.switches[i - 1].switch = value ? "on" : "off" :
                     params.switches[i - 1].switch = tAccessory.getService(Service.Switch).getCharacteristic(Characteristic.On).value ? "on" : "off";
                  if (tAccessory.getService(Service.Switch).getCharacteristic(Characteristic.On).value) {
                     masterState = "on";
                  }
               } else {
                  params.switches[i - 1].switch = "off";
               }
            }
            oAccessory = this.devicesInHB.get(accessory.context.eweDeviceId + "SW0");
            oAccessory.getService(Service.Switch).updateCharacteristic(Characteristic.On, masterState === "on");
            break;
         default:
            throw "unknown switch number [" + accessory.context.switchNumber + "]";
         }
         this.sendDeviceUpdate(accessory, params, callback);
      } catch (err) {
         let str = "[" + accessory.displayName + "] could not be updated as " + err + ".";
         this.log.error(str);
         callback(str);
      }
   }
   externalValveUpdate(accessory, params) {
      try {
         accessory.getService("Valve A")
            .updateCharacteristic(Characteristic.Active, params.switches[0].switch === "on")
            .updateCharacteristic(Characteristic.InUse, params.switches[0].switch === "on");
         accessory.getService("Valve B")
            .updateCharacteristic(Characteristic.Active, params.switches[1].switch === "on")
            .updateCharacteristic(Characteristic.InUse, params.switches[1].switch === "on");
      } catch (err) {
         this.log.warn("[%s] could not be updated - [%s].", accessory.displayName, err);
      }
   }
   externalBlindUpdate(accessory, params) {
      try {
         let blindConfig;
         if (!(blindConfig = this.cusG.get(accessory.context.hbDeviceId))) {
            throw "group config missing";
         }
         if (blindConfig.type !== "blind" || blindConfig.setup !== "twoSwitch") {
            throw "improper configuration";
         }
         let switchUp = params.switches[0].switch === "on" ? -1 : 0; // matrix of numbers to get
         let switchDown = params.switches[1].switch === "on" ? 0 : 2; // ... the correct HomeKit value
         let currentState = switchUp + switchDown;
         let newPosition = currentState * 100;
         accessory.getService(Service.WindowCovering)
            .updateCharacteristic(Characteristic.PositionState, currentState)
            .updateCharacteristic(Characteristic.TargetPosition, newPosition);
         setTimeout(() => {
            accessory.getService(Service.WindowCovering)
               .updateCharacteristic(Characteristic.PositionState, 2)
               .updateCharacteristic(Characteristic.CurrentPosition, newPosition);
         }, blindConfig.operationTime * 100);
      } catch (err) {
         this.log.warn("[%s] could not be updated - [%s].", accessory.displayName, err);
      }
   }
   externalGarageUpdate(accessory, params) {
      try {
         let garageConfig;
         if (!(garageConfig = this.cusG.get(accessory.context.hbDeviceId))) {
            throw "group config missing";
         }
         if (garageConfig.type !== "garage" || !["oneSwitch", "twoSwitch"].includes(garageConfig.setup)) {
            throw "improper configuration";
         }
         if (garageConfig.setup === "twoSwitch") {
            // to do
         } else if (garageConfig.setup === "oneSwitch" && !garageConfig.sensorId && params.switch === "on") {
            let pSte, nSte;
            pSte = accessory.getService(Service.GarageDoorOpener).getCharacteristic(Characteristic.CurrentDoorState).value;
            nSte = [0, 2].includes(pSte) ? 1 : 0;
            accessory.getService(Service.GarageDoorOpener).updateCharacteristic(Characteristic.CurrentDoorState, nSte);
         }
      } catch (err) {
         this.log.warn("[%s] could not be updated - [%s].", accessory.displayName, err);
      }
   }
   externalSensorUpdate(accessory, params) {
      try {
         this.log.warn("This is debugging. Not an error.\n" + JSON.stringify(params, null, 2));
         let service = accessory.getService(Service.ContactSensor);
         let oldState = service.getCharacteristic(Characteristic.ContactSensorState).value;
         let newState = params.switch === "on" ? 1 : 0;
         service.updateCharacteristic(Characteristic.ContactSensorState, newState);
         this.log("[%s] sent update that it was [%s] and is now [%s].", accessory.displayName, oldState ? "apart" : "joined", newState ? "apart" : "joined");
         let oAccessory = false;
         this.cusG.forEach(group => {
            if (group.sensorId === accessory.context.eweDeviceId && group.type === "garage") {
               if ((oAccessory = this.devicesInHB.get(group.deviceId + "SWX"))) {
                  if (newState === 0) {
                     oAccessory.getService(Service.GarageDoorOpener)
                        .updateCharacteristic(Characteristic.TargetDoorState, 1)
                        .updateCharacteristic(Characteristic.CurrentDoorState, 1);
                     this.log("[%s] updating to [closed] based on sensor.", oAccessory.displayName);
                  } else if (newState === 1) {
                     setTimeout(() => {
                        oAccessory.getService(Service.GarageDoorOpener)
                           .updateCharacteristic(Characteristic.TargetDoorState, 0)
                           .updateCharacteristic(Characteristic.CurrentDoorState, 0);
                        this.log("[%s] updating to [open] based on sensor.", oAccessory.displayName);
                     }, group.operationTime * 100);
                  } else {
                     throw "unknown sensor status received";
                  }
               }
            }
         });
      } catch (err) {
         this.log.warn("[%s] could not be updated - [%s].", accessory.displayName, err);
      }
   }
   externalFanUpdate(accessory, params) {
      try {
         let light;
         let status = 0;
         let speed = 0;
         if (Array.isArray(params.switches)) {
            light = params.switches[0].switch === "on";
            switch (params.switches[1].switch+params.switches[2].switch+params.switches[3].switch) {
            case "onoffoff":
            default:
               status = 1;
               speed = 33;
               break;
            case "ononoff":
               status = 1;
               speed = 66;
               break;
            case "onoffon":
               status = 1;
               speed = 99;
            }
         } else if (params.hasOwnProperty("light") && params.hasOwnProperty("fan") && params.hasOwnProperty("speed")) {
            light = params.light === "on";
            status = params.fan === "on" ? 1 : 0;
            speed = params.speed * 33 * status;
         } else {
            throw "unknown parameters received";
         }
         accessory.getService(Service.Lightbulb)
            .updateCharacteristic(Characteristic.On, light);
         accessory.getService(Service.Fanv2)
            .updateCharacteristic(Characteristic.Active, status)
            .updateCharacteristic(Characteristic.RotationSpeed, speed);
      } catch (err) {
         this.log.warn("[%s] could not be updated - [%s].", accessory.displayName, err);
      }
   }
   externalThermostatUpdate(accessory, params) {
      try {
         if (params.hasOwnProperty("switch") || params.hasOwnProperty("mainSwitch")) {
            let newState = params.hasOwnProperty("switch") ? params.switch === "on" : params.mainSwitch === "on";
            accessory.getService(Service.Switch).updateCharacteristic(Characteristic.On, newState);
         }
         if (params.hasOwnProperty("currentTemperature") && accessory.getService(Service.TemperatureSensor)) {
            let currentTemp = params.currentTemperature !== "unavailable" ? params.currentTemperature : 0;
            accessory.getService(Service.TemperatureSensor).updateCharacteristic(Characteristic.CurrentTemperature, currentTemp);
         }
         if (params.hasOwnProperty("currentHumidity") && accessory.getService(Service.HumiditySensor)) {
            let currentHumi = params.currentHumidity !== "unavailable" ? params.currentHumidity : 0;
            accessory.getService(Service.HumiditySensor).updateCharacteristic(Characteristic.CurrentRelativeHumidity, currentHumi);
         }
      } catch (err) {
         this.log.warn("[%s] could not be updated - [%s].", accessory.displayName, err);
      }
   }
   externalOutletUpdate(accessory, params) {
      try {
         accessory.getService(Service.Outlet).updateCharacteristic(Characteristic.On, params.switch === "on");
      } catch (err) {
         this.log.warn("[%s] could not be updated - [%s].", accessory.displayName, err);
      }
   }
   externalUSBUpdate(accessory, params) {
      try {
         accessory.getService(Service.Outlet).updateCharacteristic(Characteristic.On, params.switches[0].switch === "on");
      } catch (err) {
         this.log.warn("[%s] could not be updated - [%s].", accessory.displayName, err);
      }
   }
   externalSingleLightUpdate(accessory, params) {
      try {
         let newColour, mode;
         let isOn = false;
         if ((accessory.context.eweUIID === 22) && params.hasOwnProperty("state")) {
            isOn = params.state === "on";
         } else if (accessory.context.eweUIID !== 22 && params.hasOwnProperty("switch")) {
            isOn = params.switch === "on";
         } else {
            isOn = accessory.getService(Service.Lightbulb).getCharacteristic(Characteristic.On).value;
         }
         if (isOn) {
            accessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.On, true);
            switch (accessory.context.eweUIID) {
            case 36: // KING-M4
               if (params.hasOwnProperty("bright")) {
                  let nb = Math.round((params.bright - 10) * 10 / 9); // eWeLink scale is 10-100 and HomeKit scale is 0-100.
                  accessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.Brightness, nb);
               }
               break;
            case 44: // D1
               if (params.hasOwnProperty("brightness")) {
                  accessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.Brightness, params.brightness);
               }
               break;
            case 22: // B1
               if (params.hasOwnProperty("zyx_mode")) {
                  mode = parseInt(params.zyx_mode);
               } else if (params.hasOwnProperty("channel0") && (parseInt(params.channel0) + parseInt(params.channel1) > 0)) {
                  mode = 1;
               } else {
                  mode = 2;
               }
               if (mode === 2) {
                  accessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.On, true);
                  newColour = convert.rgb.hsv(parseInt(params.channel2), parseInt(params.channel3), parseInt(params.channel4));
                  accessory.getService(Service.Lightbulb)
                     .updateCharacteristic(Characteristic.Hue, newColour[0])
                     .updateCharacteristic(Characteristic.Saturation, 100)
                     .updateCharacteristic(Characteristic.Brightness, 100);
               } else if (mode === 1) {
                  throw "has been set to white mode which is not supported";
               }
               break;
            case 59: // L1
               if (params.hasOwnProperty("bright")) {
                  accessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.Brightness, params.bright);
               }
               if (params.hasOwnProperty("colorR")) {
                  newColour = convert.rgb.hsv(params.colorR, params.colorG, params.colorB);
                  accessory.getService(Service.Lightbulb)
                     .updateCharacteristic(Characteristic.Hue, newColour[0])
                     .updateCharacteristic(Characteristic.Saturation, newColour[1]);
               }
               break;
            default:
               return;
            }
         } else {
            accessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.On, false);
         }
      } catch (err) {
         this.log.warn("[%s] could not be updated - [%s].", accessory.displayName, err);
      }
   }
   externalMultiLightUpdate(accessory, params) {
      try {
         let idToCheck = accessory.context.hbDeviceId.slice(0, -1);
         let primaryState = false;
         for (let i = 1; i <= accessory.context.channelCount; i++) {
            if (this.devicesInHB.has(idToCheck + i)) {
               let oAccessory = this.devicesInHB.get(idToCheck + i);
               oAccessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.On, params.switches[i - 1].switch === "on");
               if (params.switches[i - 1].switch === "on") {
                  primaryState = true;
               }
            }
         }
         accessory.getService(Service.Lightbulb).updateCharacteristic(Characteristic.On, primaryState);
      } catch (err) {
         this.log.warn("[%s] could not be updated - [%s].", accessory.displayName, err);
      }
   }
   externalSingleSwitchUpdate(accessory, params) {
      try {
         accessory.getService(Service.Switch).updateCharacteristic(Characteristic.On, params.switch === "on");
      } catch (err) {
         this.log.warn("[%s] could not be updated - [%s].", accessory.displayName, err);
      }
   }
   externalMultiSwitchUpdate(accessory, params) {
      try {
         let idToCheck = accessory.context.hbDeviceId.slice(0, -1);
         let primaryState = false;
         for (let i = 1; i <= accessory.context.channelCount; i++) {
            if (this.devicesInHB.has(idToCheck + i)) {
               let oAccessory = this.devicesInHB.get(idToCheck + i);
               oAccessory.getService(Service.Switch).updateCharacteristic(Characteristic.On, params.switches[i - 1].switch === "on");
               if (params.switches[i - 1].switch === "on") {
                  primaryState = true;
               }
            }
         }
         accessory.getService(Service.Switch).updateCharacteristic(Characteristic.On, primaryState);
      } catch (err) {
         this.log.warn("[%s] could not be updated - [%s].", accessory.displayName, err);
      }
   }
   externalBridgeUpdate(accessory, params) {
      try {
         let idToCheck = accessory.context.hbDeviceId.slice(0, -1);
         let timeNow = new Date();
         let master = false;
         for (let i = 1; i <= accessory.context.channelCount; i++) {
            if (this.devicesInHB.has(idToCheck + i)) {
               let oAccessory = this.devicesInHB.get(idToCheck + i);
               if (params.hasOwnProperty("rfTrig" + (i - 1))) {
                  let timeOfMotion = new Date(params["rfTrig" + (i - 1)]);
                  let timeDifference = (timeNow.getTime() - timeOfMotion.getTime()) / 1000;
                  if (timeDifference < this.sensorTimeDifference) {
                     switch (oAccessory.context.sensorType) {
                     case "water":
                        oAccessory.getService(Service.LeakSensor).updateCharacteristic(Characteristic.LeakDetected, 1);
                        break;
                     case "fire":
                     case "smoke":
                        oAccessory.getService(Service.SmokeSensor).updateCharacteristic(Characteristic.SmokeDetected, 1);
                        break;
                     case "co":
                        oAccessory.getService(Service.CarbonMonoxideSensor).updateCharacteristic(Characteristic.CarbonMonoxideDetected, 1);
                        break;
                     case "co2":
                        oAccessory.getService(Service.CarbonDioxideSensor).updateCharacteristic(Characteristic.CarbonDioxideDetected, 1);
                        break;
                     case "contact":
                        oAccessory.getService(Service.ContactSensor).updateCharacteristic(Characteristic.ContactSensorState, 1);
                        break;
                     case "occupancy":
                        oAccessory.getService(Service.OccupancySensor).updateCharacteristic(Characteristic.OccupancyDetected, 1);
                        break;
                     case "motion":
                     default:
                        oAccessory.getService(Service.MotionSensor).updateCharacteristic(Characteristic.MotionDetected, true);
                        break;
                     }
                     master = true;
                     if (this.debug) {
                        this.log("[%s] has detected [%s].", oAccessory.displayName, oAccessory.context.sensorType);
                     }
                  }
               }
            }
         }
         if (master) {
            accessory.getService(Service.MotionSensor).updateCharacteristic(Characteristic.MotionDetected, true);
            setTimeout(() => {
               for (let i = 0; i <= accessory.context.channelCount; i++) {
                  if (this.devicesInHB.has(idToCheck + i)) {
                     let oAccessory = this.devicesInHB.get(idToCheck + i);
                     switch (oAccessory.context.sensorType) {
                     case "water":
                        oAccessory.getService(Service.LeakSensor).updateCharacteristic(Characteristic.LeakDetected, 0);
                        break;
                     case "fire":
                     case "smoke":
                        oAccessory.getService(Service.SmokeSensor).updateCharacteristic(Characteristic.SmokeDetected, 0);
                        break;
                     case "co":
                        oAccessory.getService(Service.CarbonMonoxideSensor).updateCharacteristic(Characteristic.CarbonMonoxideDetected, 0);
                        break;
                     case "co2":
                        oAccessory.getService(Service.CarbonDioxideSensor).updateCharacteristic(Characteristic.CarbonDioxideDetected, 0);
                        break;
                     case "contact":
                        oAccessory.getService(Service.ContactSensor).updateCharacteristic(Characteristic.ContactSensorState, 0);
                        break;
                     case "occupancy":
                        oAccessory.getService(Service.OccupancySensor).updateCharacteristic(Characteristic.OccupancyDetected, 0);
                        break;
                     case "motion":
                     default:
                        oAccessory.getService(Service.MotionSensor).updateCharacteristic(Characteristic.MotionDetected, false);
                        break;
                     }
                  }
               }
            }, this.sensorTimeLength * 1000);
         }
      } catch (err) {
         this.log.warn("[%s] could not be updated - [%s].", accessory.displayName, err);
      }
   }
}
module.exports = function (homebridge) {
   Accessory = homebridge.platformAccessory;
   Service = homebridge.hap.Service;
   Characteristic = homebridge.hap.Characteristic;
   UUIDGen = homebridge.hap.uuid;
   return eWeLink;
};