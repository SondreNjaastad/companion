var HID = require('node-hid');
const EventEmitter = require('events')

const   KEY_PACKAGE = 0x04,
        JOG_PACKAGE = 0x03,
        RESET_AUTH_STATE = [0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        CHALLANGE_RESPONSE = [0x06, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];

class SpeedEditor extends EventEmitter{
    device;
    keyDownEvent = new EventEmitter()
    previousKeyPresses;
    availableKeys;
    currentLEDState = {
        wheelKeys: 0,
        regularKeys: 0
    };

    constructor(devicepath) {
        super();
        var _availableKeys = Object.keys(this.keys);
        this.availableKeys = _availableKeys.map(k => this.keys[k]);
        this.device = new HID.HID(devicepath);
        this.device.on('data', (data) => this.handleKeyboardData(data));
        this.device.on('error', (error) => this.emit('error', error));
        this.previousKeyPresses = [];
        var timeout = Buffer.from(this.authenticate());
        setInterval(() => {
            this.authenticate();
        }, timeout.readInt16LE() * 1000)

        const header = Buffer.from([ 0x02 ]);
        const buf = Buffer.allocUnsafe(4);
        buf.writeUInt32LE(this.currentLEDState, 0);
        this.device.write(Buffer.concat([header, buf]));
        
    }

    setLED(key, value){
        var currentState = key.ledSystem == 2 ? this.currentLEDState.regularKeys : this.currentLEDState.wheelKeys;
        var state = currentState & key.led > 0;
        if(value != state){
            currentState = currentState ^ key.led;
        }
        const header = Buffer.from([ key.ledSystem ]);
        const buf = Buffer.from([0x00, 0x00, 0x00, 0x00]);
        buf.writeUInt32LE(currentState, 0);
        var resbuf = Buffer.concat([header, buf])
        this.device.write(resbuf);
    }

    toggleLED(key){
        var currentState = key.ledSystem == 2 ? this.currentLEDState.regularKeys : this.currentLEDState.wheelKeys;
        currentState = currentState ^ key.led;
        const header = Buffer.from([ key.ledSystem ]);
        const buf = Buffer.from([0x00, 0x00, 0x00, 0x00]);
        buf.writeUInt32LE(currentState, 0);
        var resbuf = Buffer.concat([header, buf])
        this.device.write(resbuf);
    }

    handleKeyboardData(data){
        if(data[0] == KEY_PACKAGE){
            let buttonsPressed = [];
            for(var i = 1; i < data.length; i+=2){
                buttonsPressed.push(this.availableKeys.find(k => k.keyCode == data.readInt16LE(i)));
            }

            var pressed = buttonsPressed.filter(b => !this.previousKeyPresses.includes(b) && b != this.keys.NONE);
            var released = this.previousKeyPresses.filter(b => !buttonsPressed.includes(b));

            pressed.forEach(button => {
                this.emit("pressed", button);
            });

            released.forEach(button => {
                this.emit("released", button);
            });

            this.previousKeyPresses = buttonsPressed;
        }
        else if (data[0] == JOG_PACKAGE){
            //console.log(`MODE: ${data.readUInt8(1)}`);
            //console.log(`Value: ${Math.round(data.readInt32LE(2)/360)}`);
            this.emit("jog", data.readInt32LE(2));
        }
    }

    authenticate() {
        this.device.sendFeatureReport(Buffer.from(RESET_AUTH_STATE));

		// # Read the keyboard challenge (for keyboard to authenticate app)
		var keyboardChallange = this.device.getFeatureReport(6, 10);
		if(!this.arraysEqual(keyboardChallange.slice(0,2), [ 0x06, 0x00 ])){
            throw('Failed authentication get_kbd_challenge');
        }
		
        var challenge = keyboardChallange.slice(2);

		// # Send our challenge (to authenticate keyboard)
		// # We don't care ... so just send 0x0000000000000000
		this.device.sendFeatureReport(CHALLANGE_RESPONSE)

		// # Read the keyboard response
		// # Again, we don't care, ignore the result
		var keyboardResponse = this.device.getFeatureReport(6, 10)
		if(!this.arraysEqual(keyboardResponse.slice(0,2), [ 0x06, 0x02 ])){
            throw('Failed authentication get_kbd_response');
        }

		// # Compute and send our response
		var response = this.bmd_kbd_auth(challenge)
        const buf2=Buffer.from([6,3]);
        const buf = Buffer.allocUnsafe(8);
        buf.writeBigUInt64LE(response, 0);       
		this.device.sendFeatureReport(Buffer.concat([buf2,buf]));

		// # Read the status
		var keyboardStatus = this.device.getFeatureReport(6, 10)
		if(!this.arraysEqual(keyboardStatus.slice(0,2), [ 0x06, 0x04 ])){
            throw('Failed authentication get_kbd_response');
        }

		// # I "think" what gets returned here is the timeout after which auth
		// # needs to be done again (returns 600 for me which is plausible)
        //console.log(keyboardStatus)
		return keyboardStatus.slice(2,4);
    }

    bmd_kbd_auth(challenge){
        const data_buf=Buffer.from(challenge);
        let _challenge = data_buf.readBigUInt64LE(0);

        let AUTH_EVEN_TBL = [
            4242707987619187656n,
            3069963097229903046n,
            2352841328256802570n,
            12646368222702737177n,
            17018789593460232529n,
            12706253227766860309n,
            11978781369061872007n,
            8438608961089703390n,
        ];
      
        let	AUTH_ODD_TBL = [
            4477338132788707294n,
            2622620659002747676n,
            11637077509869926595n,
            7923852755392722584n,
            8224257920127642516n,
            4049197610885016386n,
            18266591397768539273n,
            7035737829027231430n,
        ];
        let MASK = 12077075256910773232n;

        let n = _challenge & 7n
        let v = this.rol8n(_challenge, n)
        let k;

        if((v & 1n) == ((0x78n >> n) & 1n)){
        	k = AUTH_EVEN_TBL[n]
        }
        else {
        	v = v ^ this.rol8(v)
        	k = AUTH_ODD_TBL[n]
        }
        return v ^ (this.rol8(v) & MASK) ^ k
    }

    rol8(v){
	    return ((v << 56n) | (v >> 8n)) & 0xffffffffffffffffn
    }


    rol8n(v, n){
        for(var i = 0n; i < n; i++)
            v = this.rol8(v)
        return v
    }

    arraysEqual(a, b) {
        if (a === b) return true;
        if (a == null || b == null) return false;
        if (a.length !== b.length) return false;
      
        for (var i = 0; i < a.length; ++i) {
          if (a[i] !== b[i]) return false;
        }
        return true;
    }

    keys = {
        NONE			: { companionKeyCode: 0, keyCode: 0x00, keyLabel: '' },
    
        SMART_INSRT		: { companionKeyCode: 0, keyCode: 0x01, keyLabel: 'SMART INSRT [CLIP]', led: null, ledSystem: null },
        APPND			: { companionKeyCode: 1, keyCode: 0x02, keyLabel: 'APPND [CLIP]', led: null, ledSystem: null },
        RIPL_OWR		: { companionKeyCode: 2, keyCode: 0x03, keyLabel: 'RIPL O/WR', led: null, ledSystem: null },
        CLOSE_UP		: { companionKeyCode: 3, keyCode: 0x04, keyLabel: 'CLOSE UP [YPOS]', led: (1 << 0), ledSystem: 2 },
        PLACE_ON_TOP	: { companionKeyCode: 4, keyCode: 0x05, keyLabel: 'PLACE ON TOP', led: null, ledSystem: null },
        SRC_OWR			: { companionKeyCode: 5, keyCode: 0x06, keyLabel: 'SCR O/WR', led: null, ledSystem: null },
    
        IN				: { companionKeyCode: 6, keyCode: 0x07, keyLabel: 'IN', led: null, ledSystem: null },
        OUT				: { companionKeyCode: 7, keyCode: 0x08, keyLabel: 'OUT', led: null, ledSystem: null },
        TRIM_IN			: { companionKeyCode: 8, keyCode: 0x09, keyLabel: 'TRIM IN', led: null, ledSystem: null },
        TRIM_OUT		: { companionKeyCode: 9, keyCode: 0x0a, keyLabel: 'TRIM OUT', led: null, ledSystem: null },
        ROLL			: { companionKeyCode: 10, keyCode: 0x0b, keyLabel: 'ROLL [SLIDE]', led: null, ledSystem: null },
        SLIP_SRC		: { companionKeyCode: 11, keyCode: 0x0c, keyLabel: 'SLIP SRC', led: null, ledSystem: null },
        SLIP_DEST		: { companionKeyCode: 12, keyCode: 0x0d, keyLabel: 'SLIP DEST', led: null, ledSystem: null },
        TRANS_DUR		: { companionKeyCode: 13, keyCode: 0x0e, keyLabel: 'TRANS DUR [SET]', led: null, ledSystem: null },
        CUT				: { companionKeyCode: 14, keyCode: 0x0f, keyLabel: 'CUT', led: (1 << 1), ledSystem: 2 },
        DIS				: { companionKeyCode: 15, keyCode: 0x10, keyLabel: 'DIS', led: (1 << 2), ledSystem: 2 },
        SMTH_CUT		: { companionKeyCode: 16, keyCode: 0x11, keyLabel: 'SMTH CUT', led: (1 << 3), ledSystem: 2 },
    
        SOURCE			: { companionKeyCode: 17, keyCode: 0x1a, keyLabel: 'SOURCE', led: null, ledSystem: null },
        TIMELINE		: { companionKeyCode: 18, keyCode: 0x1b, keyLabel: 'TIMELINE', led: null, ledSystem: null },
    
        JOG				: { companionKeyCode: 19, keyCode: 0x1d, keyLabel: 'JOG', led: (1 <<  0), ledSystem: 4 },
        SHTL			: { companionKeyCode: 20, keyCode: 0x1c, keyLabel: 'SHTL', led: (1 <<  1), ledSystem: 4 },
        SCRL			: { companionKeyCode: 21, keyCode: 0x1e, keyLabel: 'SCRL', led: (1 <<  2), ledSystem: 4 },
    
        ESC				: { companionKeyCode: 22, keyCode: 0x31, keyLabel: 'ESC [UNDO]', led: null, ledSystem: null },
        SYNC_BIN		: { companionKeyCode: 23, keyCode: 0x1f, keyLabel: 'SYNC BIN', led: null, ledSystem: null },
        AUDIO_LEVEL		: { companionKeyCode: 24, keyCode: 0x2c, keyLabel: 'AUDIO LEVEL [MARK]', led: null, ledSystem: null },
        FULL_VIEW		: { companionKeyCode: 25, keyCode: 0x2d, keyLabel: 'FULL VIEW [RVW]', led: null, ledSystem: null },
        TRANS			: { companionKeyCode: 26, keyCode: 0x22, keyLabel: 'TRANS [TITLE]', led: (1 << 4), ledSystem: 2 },
        SPLIT			: { companionKeyCode: 27, keyCode: 0x2f, keyLabel: 'SPLIT [MOVE]', led: null, ledSystem: null },
        SNAP			: { companionKeyCode: 28, keyCode: 0x2e, keyLabel: 'SNAP [:]', led: (1 << 5), ledSystem: 2 },
        RIPL_DEL		: { companionKeyCode: 29, keyCode: 0x2b, keyLabel: 'RIPL DEL', led: null, ledSystem: null },
    
        CAM1			: { companionKeyCode: 30, keyCode: 0x33, keyLabel: 'CAM1', led: (1 << 14), ledSystem: 2 },
        CAM2			: { companionKeyCode: 31, keyCode: 0x34, keyLabel: 'CAM2', led: (1 << 15), ledSystem: 2 },
        CAM3			: { companionKeyCode: 32, keyCode: 0x35, keyLabel: 'CAM3', led: (1 << 16), ledSystem: 2 },
        CAM4			: { companionKeyCode: 33, keyCode: 0x36, keyLabel: 'CAM4', led: (1 << 10), ledSystem: 2 },
        CAM5			: { companionKeyCode: 34, keyCode: 0x37, keyLabel: 'CAM5', led: (1 << 11), ledSystem: 2 },
        CAM6			: { companionKeyCode: 35, keyCode: 0x38, keyLabel: 'CAM6', led: (1 << 12), ledSystem: 2 },
        CAM7			: { companionKeyCode: 36, keyCode: 0x39, keyLabel: 'CAM7', led: (1 << 6), ledSystem: 2 },
        CAM8			: { companionKeyCode: 37, keyCode: 0x3a, keyLabel: 'CAM8', led: (1 << 7), ledSystem: 2 },
        CAM9			: { companionKeyCode: 38, keyCode: 0x3b, keyLabel: 'CAM9', led: (1 << 8), ledSystem: 2 },
        LIVE_OWR		: { companionKeyCode: 39, keyCode: 0x30, keyLabel: 'LIVE O/WR [RND]', led: (1 << 9), ledSystem: 2 },
        VIDEO_ONLY		: { companionKeyCode: 40, keyCode: 0x25, keyLabel: 'VIDEO ONLY', led: (1 << 13), ledSystem: 2 },
        AUDIO_ONLY		: { companionKeyCode: 41, keyCode: 0x26, keyLabel: 'AUDIO ONLY', led: (1 << 17), ledSystem: 2 },
        STOP_PLAY		: { companionKeyCode: 42, keyCode: 0x3c, keyLabel: 'STOP/PLAY', led: null, ledSystem: null },
    }
};

module.exports = SpeedEditor;