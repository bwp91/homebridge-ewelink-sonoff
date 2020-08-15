/* jshint esversion: 9, -W030, node: true */
"use strict";
module.exports = {
   appId: "oeVkj2lYFGnJu5XUtWisfW4utiN4u9Mq",
   packageName: "homebridge-ewelink-sonoff",
   devicesHideable: ["switch", "light", "valve"],
   devicesSingleSwitch: [1, 5, 6, 14, 15, 22, 24, 27, 32, 36, 44, 59],
   devicesSingleSwitchLight: ["T1 1C", "L1", "B1", "B1_R2", "TX1C", "D1", "D1R1", "KING-M4", "Slampher"],
   devicesMultiSwitch: [2, 3, 4, 7, 8, 9, 29, 30, 31, 34, 41],
   devicesMultiSwitchLight: ["T1 2C", "T1 3C", "TX2C", "TX3C"],
   devicesBrightable: [36, 44],
   devicesColourable: [22, 59],
   devicesSensor: [102],
   devicesThermostat: [15],
   devicesFan: [34],
   devicesOutlet: [32],
   devicesUSB: [77],
   devicesSCM: [78],
   devicesRFBridge: [28],
   devicesZBBridge: [66],
   devicesZB: [1000, 1770, 2026, 3026],
   paramsToKeep: ["bright", "brightness", "channel", "cmd", "colorB", "colorG", "colorR", "currentHumidity", "currentTemperature", "fan", "humidity", "key", "light", "lock", "mainSwitch", "mode", "online", "rfChl", "rfList", "rfTrig", "sensorType", "speed", "state", "switch", "switches", "temperature", "type", "zyx_mode"],
   chansFromUiid: {
      1: 1, // "SOCKET"                                  \\ 20, MINI, BASIC, S26
      2: 2, // "SOCKET_2"                                \\ 
      3: 3, // "SOCKET_3"                                \\ 
      4: 4, // "SOCKET_4",                               \\ 
      5: 1, // "SOCKET_POWER"                            \\ 
      6: 1, // "SWITCH"                                  \\ T1 1C, TX1C
      7: 2, // "SWITCH_2"                                \\ T1 2C, TX2C
      8: 3, // "SWITCH_3"                                \\ T1 3C, TX3C
      9: 4, // "SWITCH_4"                                \\ 
      10: 0, // "OSPF"                                   \\ 
      11: 0, // "CURTAIN"                                \\ King Q4 Cover
      12: 0, // "EW-RE"                                  \\ 
      13: 0, // "FIREPLACE"                              \\ 
      14: 1, // "SWITCH_CHANGE"                          \\ 
      15: 1, // "THERMOSTAT"                             \\ TH10, TH16
      16: 0, // "COLD_WARM_LED"                          \\ 
      17: 0, // "THREE_GEAR_FAN"                         \\ 
      18: 0, // "SENSORS_CENTER"                         \\ 
      19: 0, // "HUMIDIFIER"                             \\ 
      22: 1, // "RGB_BALL_LIGHT"                         \\ B1, B1_R2
      23: 0, // "NEST_THERMOSTAT"                        \\ 
      24: 1, // "GSM_SOCKET"                             \\
      25: 0, // "AROMATHERAPY",                          \\ Diffuser
      26: 0, // "RuiMiTeWenKongQi"                       \\
      27: 1, // "GSM_UNLIMIT_SOCKET"                     \\
      28: 1, // "RF_BRIDGE"                              \\ RFBridge, RF_Bridge
      29: 2, // "GSM_SOCKET_2"                           \\
      30: 3, // "GSM_SOCKET_3"                           \\
      31: 4, // "GSM_SOCKET_4"                           \\
      32: 1, // "POWER_DETECTION_SOCKET"                 \\ Pow_R2 POW
      33: 0, // "LIGHT_BELT",                            \\
      34: 4, // "FAN_LIGHT"                              \\ iFan02, iFan
      35: 0, // "EZVIZ_CAMERA",                          \\
      36: 1, // "SINGLE_CHANNEL_DIMMER_SWITCH"           \\ KING-M4
      38: 0, // "HOME_KIT_BRIDGE",                       \\
      40: 0, // "FUJIN_OPS"                              \\
      41: 4, // "CUN_YOU_DOOR"                           \\
      42: 0, // "SMART_BEDSIDE_AND_NEW_RGB_BALL_LIGHT"   \\ 
      43: 0, // "?"                                      \\ 
      44: 1, // "SNOFF_LIGHT"                            \\ D1
      45: 0, // "DOWN_CEILING_LIGHT"                     \\
      46: 0, // "AIR_CLEANER"                            \\
      49: 0, // "MACHINE_BED"                            \\
      51: 0, // "COLD_WARM_DESK_LIGHT"                   \\
      52: 0, // "DOUBLE_COLOR_DEMO_LIGHT"                \\
      53: 0, // "ELECTRIC_FAN_WITH_LAMP"                 \\
      55: 0, // "SWEEPING_ROBOT"                         \\
      56: 0, // "RGB_BALL_LIGHT_4"                       \\
      57: 0, // "MONOCHROMATIC_BALL_LIGHT"               \\
      59: 1, // "MUSIC_LIGHT_BELT"                       \\ L1
      60: 0, // "NEW_HUMIDIFIER"                         \\
      61: 0, // "KAI_WEI_ROUTER"                         \\
      62: 0, // "MEARICAMERA"                            \\
      64: 0, // "HeatingTable"                           \\
      65: 0, // "CustomCamera"                           \\
      66: 0, // "ZIGBEE_MAIN_DEVICE"                     \\
      67: 0, // "RollingDoor"                            \\
      68: 0, // "KOOCHUWAH"                              \\
      69: 0, // "ATMOSPHERE_LAMP"                        \\
      76: 0, // "YI_GE_ER_LAMP"                          \\
      77: 4, // "SINGLE_SOCKET_MULTIPLE"                 \\ (1 socket device using data structure of four :()
      78: 4, // "SINGLE_SWITCH_MULTIPLE"                 \\ (1 switch device using data structure of four :()
      79: 0, // "CHRISTMAS_LIGHT"                        \\
      80: 0, // "HANYUAN_AIR_CONDITION"                  \\
      81: 1, // "GSM_SOCKET_NO_FLOW"                     \\
      82: 2, // "GSM_SOCKET_2_NO_FLOW"                   \\
      83: 3, // "GSM_SOCKET_3_NO_FLOW"                   \\
      84: 4, // "GSM_SOCKET_4_NO_FLOW"                   \\
      86: 0, // "CLEAR_BOOT"                             \\
      87: 0, // "EWELINK_IOT_CAMERA"                     \\ GK-200MP2B
      88: 0, // "YK_INFRARED"                            \\
      89: 0, // "SMART_OPEN_MACHINE"                     \\
      90: 0, // "GSM_RFBridge"                           \\
      91: 0, // "ROLLING_DOOR_91"                        \\
      93: 0, // "HTHD_AIR_CLEANER"                       \\
      94: 0, // "YIAN_ELECTRIC_PROTECT"                  \\
      98: 0, // "DOORBELL_RFBRIDGE"                      \\
      102: 1, // "DOOR_MAGNETIC"                         \\ OPL-DMA, DW2
      103: 0, // "WOTEWODE_TEM_LIGHT"                    \\
      104: 0, // "WOTEWODE_RGB_TEM_LIGHT"                \\
      107: 0, // "GSM_SOCKET_NO_FLOW"                    \\
      109: 0, // "YK_INFRARED_2"                         \\
      1000: 1, // "ZIGBEE_WIRELESS_SWITCH"               \\
      1001: 0, // "BLADELESS_FAN"                        \\
      1002: 0, // "NEW_HUMIDIFIER"                       \\
      1003: 0, // "WARM_AIR_BLOWER"                      \\
      1256: 1, // "ZIGBEE_SINGLE_SWITCH"                 \\
      1770: 1, // "ZIGBEE_TEMPERATURE_SENSOR"            \\
      2026: 1, // "ZIGBEE_MOBILE_SENSOR"                 \\
      2256: 2, // "ZIGBEE_SWITCH_2"                      \\
      3026: 1, // "ZIGBEE_DOOR_AND_WINDOW_SENSOR"        \\
      3256: 3, // "ZIGBEE_SWITCH_3"                      \\
      4026: 1, // "ZIGBEE_WATER_SENSOR"                  \\
      4256: 4, // "ZIGBEE_SWITCH_4"                      \\
   }
};