const util = require('util')
const debug = require('debug')('lib/usb/speededitor')
const common = require('./common')
const SpeedEditorDevice = require('./SpeedEditor-base');
const HID = require('node-hid')
let log

const   WHEEL_OPERATION_JOG = 'jog',
        WHEEL_OPERATION_SHTL = 'shtl',
        WHEEL_OPERATION_SCRL = 'scrl'

class speededitor {
    constructor(system, devicepath) {
        try{
            util.inherits(speededitor, common)
            this.debug = debug
            this.system = system
            this.internal = {
                label: 'internal',
            }
            this.label = 'SpeedEditor'
            this.wheelOperation = WHEEL_OPERATION_JOG;
            this.info = {}
            this.type = this.info.type = 'Speed Editor device'
            this.info.id = 'SpeedEditor'
            this.info.config = ['brightness']
            this.info.keysTotal = 43
            this.config = {
                brightness: 10,
                keysPerRow: 10,
                keysPerColumn: 8,
                tbarPosition: 0,
                jog: 0,
                shuttle: 0,
                joystick: 0,
                page: 1,
                bits: 8,
                enable_device: true,
            }
            this.info.serialnumber = this.serialnumber = "SpeedEditor"
            this.info.devicepath = this.devicepath = devicepath


            this.system.on('variable_get_definitions', (data) => {
                console.log(data)
            });

            this.system.emit('variable_instance_definitions_set', this, [
                {
                    label: 'Scroll',
                    name: 'scrl'
                },
                {
                    label: 'Jog',
                    name: 'jog'
                },
                {
                    label: 'Shuttle',
                    name: 'shtl'
                },
            ]);


            this.createSpeedEditor(devicepath)
            common.apply(this, arguments)
            return this
        } catch (error){
            console.log(error);
        }
    }

    decimalToRgb(decimal) {
		return {
			red: (decimal >> 16) & 0xff,
			green: (decimal >> 8) & 0xff,
			blue: decimal & 0xff,
		}
	}

    createSpeedEditor(devicepath){
        var device = new SpeedEditorDevice(devicepath);
        
        device.on('pressed', (key) => {
            if(key == device.keys.JOG){
                this.wheelOperation = WHEEL_OPERATION_JOG;
                device.setLED(device.keys.JOG, true);
                device.setLED(device.keys.SHTL, false);
                device.setLED(device.keys.SCRL, false);
            } else if(key == device.keys.SHTL){
                this.wheelOperation = WHEEL_OPERATION_SHTL;
                device.setLED(device.keys.JOG, false);
                device.setLED(device.keys.SHTL, true);
                device.setLED(device.keys.SCRL, false);
            } else if(key == device.keys.SCRL){
                this.wheelOperation = WHEEL_OPERATION_SCRL;
                device.setLED(device.keys.JOG, false);
                device.setLED(device.keys.SHTL, false);
                device.setLED(device.keys.SCRL, true);
            } else {
                this.system.emit('elgato_click', devicepath, key.companionKeyCode, true);
            }
        });

        device.on('released', (key) => {
            this.system.emit('elgato_click', devicepath, key.companionKeyCode, false)
        });

        var jog = 0;
        var lastSend = new Date().getTime();
        var spinTimeout = {};
        device.on('jog', (value) => {
            var c = new Date().getTime();
            var outputValue;
            if(this.wheelOperation == WHEEL_OPERATION_JOG){
                jog += (value/10000.0).clamp(-5, 5);
                jog = jog.clamp(0, 100)
                outputValue = Math.round(jog);
            } else {
                outputValue = Math.round(value/360.0);
                clearTimeout(spinTimeout);
                spinTimeout = setTimeout(() => {
                    this.system.emit('variable_instance_set', this, this.wheelOperation, 0)
                }, 100)
            }
            if(c - lastSend > 50 && (value > 200 || value < -200)){
                this.system.emit('variable_instance_set', this, this.wheelOperation, outputValue)
                lastSend = c;
            }
        });

        Number.prototype.clamp = function(min, max) {
            return Math.min(Math.max(this, min), max);
        };

        device.on('error', (error) => {
			this.log(error)
			this.system.emit('elgatodm_remove_device', devicepath)
		});

        this.system.on('graphics_set_bank_bg', (page, bank, bgcolor) => {
			let color = this.decimalToRgb(bgcolor)
			let buttonNumber = parseInt(page) * 32 - parseInt(this.config.page) * 32 + parseInt(bank)
			let button = device.availableKeys.find(k => k.companionKeyCode == buttonNumber-1);
            if(
                button.led != null && 
                !(
                    button == device.availableKeys.JOG ||
                    button == device.availableKeys.SHTL ||
                    button == device.availableKeys.SCRL
                )
            ){
                if(color.red > 125) {
                    device.setLED(button, true)
                } else {
                    device.setLED(button, false)
                }
            }

			this.log(`graphics_set_bank_bg received in xkeys ${page}, ${bank}, ${color.red}`)
		})

    }

    setImmediate() {
		this.system.emit('elgato_ready', devicepath)
	}
}

exports = module.exports = speededitor