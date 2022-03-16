/*
 * This file is part of the Companion project
 * Copyright (c) 2018 Bitfocus AS
 * Authors: William Viker <william@bitfocus.io>, Håkon Nessjøen <haakon@bitfocus.io>
 *
 * This program is free software.
 * You should have received a copy of the MIT licence as well as the Bitfocus
 * Individual Contributor License Agreement for companion along with
 * this program.
 *
 * You can be released from the requirements of the license by purchasing
 * a commercial license. Buying such a license is mandatory as soon as you
 * develop commercial activities involving the Companion software without
 * disclosing the source code of your own applications.
 *
 */

const CoreBase = require('../Core/Base')

class SurfaceHandler extends CoreBase {
	debug = require('debug')('lib/Surface/Handler')

	constructor(registry, panel) {
		super(registry, `device(${panel.serialnumber})`, `lib/Surface/Handler/${panel.serialnumber}`)
		this.debug('loading for ' + panel.devicepath)

		this.panel = panel
		this.isSurfaceLocked = this.userconfig.getKey('pin_enable')

		this.lastinteraction = Date.now()
		this.lockoutat = Date.now()
		this.currentpin = ''
		this.devicepath = panel.devicepath
		this.currentPage = 1 // The current page of the device
		this.lastpress = ''
		this.lastpage = 0
		this.deviceconfig = this.db.getKey('deviceconfig', {})
		this.panelconfig = {}
		this.panelinfo = {}

		this.panelinfo = {
			xOffsetMax: 0,
			yOffsetMax: 0,
		}

		// Fill in max offsets
		const keysPerRow = this.panel.keysPerRow || 0
		const keysTotal = this.panel.keysTotal || 0
		if (keysPerRow && keysTotal) {
			const maxRows = Math.ceil(global.MAX_BUTTONS / global.MAX_BUTTONS_PER_ROW)
			this.panelinfo.xOffsetMax = Math.max(Math.floor(global.MAX_BUTTONS_PER_ROW - keysPerRow), 0)
			this.panelinfo.yOffsetMax = Math.max(Math.floor(maxRows - Math.ceil(keysTotal / keysPerRow)), 0)
		}

		if (!this.deviceconfig[this.panel.serialnumber]) {
			this.deviceconfig[this.panel.serialnumber] = this.panelconfig = {}
			this.debug(`Creating config for newly discovered device ${this.panel.serialnumber}`)
		} else {
			this.debug(`Reusing config for device ${this.panel.serialnumber} was on page ${this.currentPage}`)
		}

		// Load existing config
		this.panelconfig = this.deviceconfig[this.panel.serialnumber]
		if (!this.panelconfig.config) {
			this.panelconfig.config = {
				// defaults from the panel - TODO properly
				brightness: 100,
				rotation: 0,

				// companion owned defaults
				use_last_page: true,
				page: 1,
				xOffset: 0,
				yOffset: 0,
			}
		}

		if (this.panelconfig.config.xOffset === undefined || this.panelconfig.config.yOffset === undefined) {
			// Fill in missing default offsets
			this.panelconfig.config.xOffset = 0
			this.panelconfig.config.yOffset = 0
		}

		if (this.panelconfig.config.use_last_page === undefined) {
			// Fill in the new field based on previous behaviour:
			// If a page had been chosen, then it would start on that
			this.panelconfig.config.use_last_page = this.panelconfig.config.page === undefined
		}

		if (this.panelconfig.config.use_last_page) {
			if (this.panelconfig.page !== undefined) {
				// use last page if defined
				this.currentPage = this.panelconfig.page
			}
		} else {
			if (this.panelconfig.config.page !== undefined) {
				// use startup page if defined
				this.currentPage = this.panelconfig.page = this.panelconfig.config.page
			}
		}

		if (this.panel && this.panel.setConfig) {
			const config = this.panelconfig.config
			setImmediate(() => {
				this.panel.setConfig(config, (redraw) => {
					if (redraw) {
						// device wants a redraw
						this.drawPage()
					}
				})
			})
		}

		this.onBankInvalidated = this.onBankInvalidated.bind(this)

		this.system.on('graphics_bank_invalidated', this.onBankInvalidated)

		this.timeouttimer = setInterval(() => {
			if (
				this.userconfig.getKey('pin_timeout') != 0 &&
				this.userconfig.getKey('pin_enable') == true &&
				Date.now() >= this.lockoutat &&
				!this.isSurfaceLocked
			) {
				if (this.userconfig.getKey('link_lockouts')) {
					this.system.emit('lockoutall')
				} else {
					this.isSurfaceLocked = true
					this.drawPage()
				}
			}
			if (this.isSurfaceLocked && !this.userconfig.getKey('pin_enable')) {
				this.isSurfaceLocked = false
				this.drawPage()
			}
		}, 1000)

		this.onDeviceReady = this.onDeviceReady.bind(this)
		this.onDeviceClick = this.onDeviceClick.bind(this)

		this.system.on('device_ready', this.onDeviceReady)
		this.system.on('device_click', this.onDeviceClick)
	}

	get deviceId() {
		return this.panel.serialnumber
	}

	#deviceIncreasePage() {
		this.currentPage++
		if (this.currentPage >= 100) {
			this.currentPage = 1
		}
		if (this.currentPage <= 0) {
			this.currentPage = 99
		}

		this.#storeNewDevicePage(this.currentPage)
	}

	#deviceDecreasePage() {
		this.currentPage--
		if (this.currentPage >= 100) {
			this.currentPage = 1
		}
		if (this.currentPage <= 0) {
			this.currentPage = 99
		}

		this.#storeNewDevicePage(this.currentPage)
	}

	drawPage() {
		if (!this.isSurfaceLocked) {
			const data = this.graphics.getImagesForPage(this.currentPage)

			const xOffset = Math.min(Math.max(this.panelconfig.config.xOffset || 0, 0), this.panelinfo.xOffsetMax)
			const yOffset = Math.min(Math.max(this.panelconfig.config.yOffset || 0, 0), this.panelinfo.yOffsetMax)

			for (let i in data) {
				// Note: the maths looks inverted, but it goes through the toDeviceKey still
				const key = i - xOffset - yOffset * global.MAX_BUTTONS_PER_ROW

				this.panel.draw(key, data[i].buffer, data[i].style)
			}
		} else {
			/* TODO: We should move this to the device module */
			const datap = this.graphics.getImagesForPincode(this.currentpin)
			this.panel.clearDeck()
			this.panel.draw(12, datap[0].buffer)
			this.panel.draw(17, datap[1].buffer)
			this.panel.draw(18, datap[2].buffer)
			this.panel.draw(19, datap[3].buffer)
			this.panel.draw(9, datap[4].buffer)
			this.panel.draw(10, datap[5].buffer)
			this.panel.draw(11, datap[6].buffer)
			this.panel.draw(1, datap[7].buffer)
			this.panel.draw(2, datap[8].buffer)
			this.panel.draw(3, datap[9].buffer)
			this.panel.draw(8, datap[10].buffer)
		}
	}

	getDeviceInfo() {
		return {
			id: this.panel.id || '',
			serialnumber: this.panel.serialnumber || '',
			type: this.panel.type || '',
			name: this.panelconfig.name || '',
			config: this.panel.config || [], // config fields
		}
	}

	getPanelConfig() {
		return this.panelconfig.config
	}

	getPanelInfo() {
		return this.panelinfo
	}

	setLocked(locked) {
		if (!locked) {
			// Reset timers for next auto-lock
			this.lastinteraction = Date.now()
			this.lockoutat = this.userconfig.getKey('pin_timeout') * 1000 + Date.now()
		}

		// If it changed, redraw
		if (this.isSurfaceLocked != locked) {
			this.isSurfaceLocked = !!locked

			this.drawPage()
		}
	}

	quit() {
		this.unload()
	}

	onBankInvalidated(page, bank) {
		this.updateBank(page, bank)
	}

	setBrightness(brightness) {
		if (this.panel && this.panel.setConfig) {
			const config = {
				...this.panelconfig.config,
				brightness: brightness,
			}

			setImmediate(() => {
				this.panel.setConfig(config, (redraw) => {})
			})
		}
	}

	onDeviceClick(devicepath, key, state) {
		if (devicepath != this.devicepath) {
			return
		}
		if (!this.isSurfaceLocked) {
			this.lastinteraction = Date.now()
			this.lockoutat = this.userconfig.getKey('pin_timeout') * 1000 + Date.now()

			// Translate key for offset
			const xOffset = Math.min(Math.max(this.panelconfig.config.xOffset || 0, 0), this.panelinfo.xOffsetMax)
			const yOffset = Math.min(Math.max(this.panelconfig.config.yOffset || 0, 0), this.panelinfo.yOffsetMax)

			// Note: the maths looks inverted, but its already been through toGlobalKey
			key = parseInt(key) + xOffset + yOffset * global.MAX_BUTTONS_PER_ROW

			let thispress = this.panel.serialnumber + '_' + this.currentPage
			if (state) {
				this.lastpress = thispress
				this.lastpage = this.currentPage
			} else if (thispress != this.lastpress) {
				// page changed on this device before button released
				// release the old page+bank
				this.bank.action.pressBank(this.lastpage, key + 1, false, this.panel.serialnumber)
				this.lastpress = ''
				return
			} else {
				this.lastpress = ''
			}

			this.bank.action.pressBank(this.currentPage, key + 1, state, this.panel.serialnumber)
			this.log('debug', 'Button ' + this.currentPage + '.' + (key + 1) + ' ' + (state ? 'pressed' : 'released'))
		} else {
			if (state) {
				const decode = [12, 17, 18, 19, 9, 10, 11, 1, 2, 3]

				if (decode.indexOf(key).toString() != -1) {
					this.currentpin += decode.indexOf(key).toString()
				}

				if (this.currentpin == this.userconfig.getKey('pin').toString()) {
					this.isSurfaceLocked = false
					this.currentpin = ''
					this.lastinteraction = Date.now()
					this.lockoutat = this.userconfig.getKey('pin_timeout') * 1000 + Date.now()

					this.drawPage()

					if (this.userconfig.getKey('link_lockouts')) {
						this.system.emit('unlockoutall')
					}
				} else if (this.currentpin.length >= this.userconfig.getKey('pin').toString().length) {
					this.currentpin = ''
				}
			}

			if (this.isSurfaceLocked) {
				// Update lockout button
				const datap = this.graphics.getImagesForPincode(this.currentpin)
				this.panel.draw(8, datap[10].buffer)
			}
		}
	}

	doPageDown() {
		if (this.userconfig.getKey('page_direction_flipped') === true) {
			this.#deviceIncreasePage()
		} else {
			this.#deviceDecreasePage()
		}
	}

	setCurrentPage(page) {
		this.currentPage = page
		if (this.currentPage == 100) {
			this.currentPage = 1
		}
		if (this.currentPage == 0) {
			this.currentPage = 99
		}
		this.#storeNewDevicePage(this.currentPage)
	}

	getCurrentPage() {
		return this.currentPage
	}

	doPageUp() {
		if (this.userconfig.getKey('page_direction_flipped') === true) {
			this.#deviceDecreasePage()
		} else {
			this.#deviceIncreasePage()
		}
	}

	onDeviceReady(devicepath) {
		if (devicepath == this.devicepath) {
			this.panel.begin()
			this.drawPage()
		}
	}

	setPanelConfig(newconfig) {
		if (!newconfig.use_last_page && newconfig.page !== undefined && newconfig.page !== this.panelconfig.config.page) {
			// Startup page has changed, so change over to it
			this.#storeNewDevicePage(newconfig.page)
		}

		let redraw = false
		if (newconfig.xOffset != this.panelconfig.config.xOffset || newconfig.yOffset != this.panelconfig.config.yOffset)
			redraw = true

		this.panelconfig.config = newconfig
		this.db.setKey('deviceconfig', this.deviceconfig)

		if (this.panel && this.panel.setConfig) {
			this.panel.setConfig(newconfig, (_redraw) => {
				if (redraw || _redraw) {
					// device wants a redraw
					this.drawPage()
				}
			})
		} else {
			if (redraw) {
				this.drawPage()
			}
		}
	}

	setPanelName(newname) {
		if (typeof newname === 'string') {
			this.panelconfig.name = newname

			// save it
			this.db.setKey('deviceconfig', this.deviceconfig)
		}
	}

	#storeNewDevicePage(newpage) {
		this.panelconfig.page = this.currentPage = newpage
		this.db.setKey('deviceconfig', this.deviceconfig)

		this.drawPage()
	}

	unload() {
		this.log('error', this.panel.type + ' disconnected')
		this.debug('unloading for ' + this.devicepath)
		this.system.removeListener('graphics_bank_invalidated', this.onBankInvalidated)
		this.system.removeListener('device_ready', this.onDeviceReady)
		this.system.removeListener('device_click', this.onDeviceClick)

		try {
			this.panel.quit()
		} catch (e) {}

		delete this.panel.device
		delete this.panel
	}

	updateBank(page, bank) {
		// If device is locked ignore updates. pincode updates are handled separately
		if (!this.isSurfaceLocked) {
			let img = this.graphics.getBank(page, bank)

			if (page == this.currentPage) {
				const xOffset = Math.min(Math.max(this.panelconfig.config.xOffset || 0, 0), this.panelinfo.xOffsetMax)
				const yOffset = Math.min(Math.max(this.panelconfig.config.yOffset || 0, 0), this.panelinfo.yOffsetMax)

				// Note: the maths looks inverted, but it goes through the toDeviceKey still
				const key = bank - 1 - xOffset - yOffset * global.MAX_BUTTONS_PER_ROW

				// 12-Jan-2020: was wrapped with setImmediate
				// which delays the button draw.
				// if the page changed, the old button gfx gets put on the new page
				this.panel.draw(key, img.buffer, img.style)
			}
		}
	}
}

exports = module.exports = SurfaceHandler