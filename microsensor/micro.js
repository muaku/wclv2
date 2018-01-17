const SerialPort = require('serialport');
const fs = require("fs")
const mqtt = require('mqtt')
const fluentd = require('fluent-logger');
const bsplit = require('buffer-split')
var CronJob = require('cron').CronJob;
const Broker = require("./config").Broker
var isActive = false     /* マイクロ波センサーが正常に動いていることの確認フラグ */
var activeTimer

/* DB */
const mongoose = require("mongoose")
const _ = require("lodash")
const MongoDB = require("./config").MongoDB
const mongodbURL = `mongodb://localhost/${MongoDB.dbName}`
mongoose.connect(mongodbURL, {useMongoClient: true})    /* Connect to mongodb */
const micro = require("./model").micro
const moment = require("moment-timezone")



/* DEFINE */
const PRE = Buffer.from([0x80, 0x00, 0x80, 0x00,0x80, 0x00,0x80, 0x00]);
const TYPE1 = {
  VAL: 1,
  LEN: 18,
  DATA_LEN: 6,
  /* INDEX AFTER REMOVING 'PRE' BUFFER */
  HEART: {
    FROM_INDEX: 2,
    TO_INDEX: 4
  },
  BREATH: {
    FROM_INDEX: 4,
    TO_INDEX: 6
  } 
}
const TYPE2 = {
  VAL: 2,
  LEN: 14,
  DATA_LEN: 2,
  /* INDEX AFTER REMOVING 'PRE' BUFFER */
  DATA_START_INDEX: 2,
  DATA_END_INDEX: 3
}
const TYPE3 = {
  VAL: 3,
  LEN: 14,
  DATA_LEN: 2,
  /* INDEX AFTER REMOVING 'PRE' BUFFER */
  DATA_START_INDEX: 2,
  DATA_END_INDEX: 3
}
const TYPE9 = {
  VAL: 9,
  LEN: 14,
  DATA_LEN: 2,
  /* INDEX AFTER REMOVING 'PRE' BUFFER */
  DATA_START_INDEX: 2,
  DATA_END_INDEX: 4
}
const TYPE10 = {
  VAL: 10,
  LEN: 14,
  DATA_LEN: 2,
  /* INDEX AFTER REMOVING 'PRE' BUFFER */
  DATA_START_INDEX: 2,
  DATA_END_INDEX: 4
}

 /* DATA TO PASS TO Fluentd */
var DATA_TO_FLUENTD = {}

/* OPEN PORT ON MAC OR RASPI */
const portNumber = (process.platform == "darwin") ? '/dev/tty.usbserial-AL00AWMB' : '/dev/ttyUSB0'
const port = new SerialPort(portNumber, {
  baudRate: 115200
}, function(err) {
  if(err) {
    return console.log("Cant open port with Error: ", err.message)
  }
})

/* READ data */
var buffer = Buffer.from([])
var lenToDelete = 0
port.on("data", function(chunk) {
  /* timer の設定：10秒間に来るデータがなければ、dbに保存する作業を一時停止させる */
  isActive = true
  if(activeTimer) {
    clearTimeout(activeTimer)
  }
  activeTimer = setTimeout(() => {
    isActive = false
  }, 10000)
  /* End timer 設定 */

  buffer = Buffer.concat([buffer, chunk])
  var datas = bsplit(buffer,PRE)
  var datas_len = datas.length 
  
  // datas[0] is empty 
  if(datas_len > 2) {
    lenToDelete = 0
    for (i=1; i<= datas_len-2; i++) { // first&last elementを含まない
      var type = datas[i].readUIntBE(0,1) // GET type
      extractData(type, datas[i]) // should use child process
      /* bufferの利用した分を消す */
      if(i===datas_len-2) {
        buffer = buffer.slice(lenToDelete)
      }
    }
  }
})

/* EXTRACT data */
const extractData = function(type, data) {
   switch(type) {
     case 1:
      lenToDelete += TYPE1.LEN
      break
     case 2:
      lenToDelete += TYPE2.LEN
      var heart = data.readUIntBE(TYPE2.DATA_START_INDEX, 1)  // Read 1 byte
      DATA_TO_FLUENTD["heart"] = heart
      // fluentd.emit("heart", {"heart": heart})
      // console.log('data to fluentd HEART: ', heart)
      break
     case 3:
      lenToDelete += TYPE3.LEN
      var breath = data.readUIntBE(TYPE3.DATA_START_INDEX, 1)
      DATA_TO_FLUENTD["breath"] = breath
      // fluentd.emit("breath", {"breath": breath})
      // console.log('data to fluentd BREATH: ', breath)
      break
     case 9:
        lenToDelete += TYPE9.LEN
      break
     case 10:
      lenToDelete += TYPE10.LEN
      var motion = data.readInt16BE(TYPE3.DATA_START_INDEX, 2)
      DATA_TO_FLUENTD["motion"] = motion
      // console.log('motion:', motion)  
      break
     default:
        console.log("TYPE is out of range")
   }
}



/* RUN EVERY 5 SEC */
var Job = new CronJob('*/5 * * * * *', function() {
  if(isActive) {
    console.log("RUN EVERY 5 SEC ", Date())
    console.log("saved: ", DATA_TO_FLUENTD)
    /* TODO: save data to db */
    DATA_TO_FLUENTD["created_at"] = moment().format()
    var microData = new micro(DATA_TO_FLUENTD)
    microData.save()

    console.log("*----------------------------------------------* ")
  }else {
    console.log("マイクロ波データを認識できないので、配線を確認して再実行してください！")
  }
}).start()
