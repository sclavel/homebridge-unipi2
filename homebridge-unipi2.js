const Evok = require("unipi-evok");
const https = require('https');

const PLUGIN_NAME = "homebridge-unipi2"; // Name of the plugin, used when registering or unregistering.
const PLATFORM_NAME = "UniPi2"; // Used by HomeBridge to find the configuration entries of the platform.

module.exports = function (homebridge) {
    homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, UniPiPlatform, true);
};

class UniPiPlatform {
    // homebridge interfaces

    constructor(log, config, homebridge) {
        log("UniPi2 plugin for HomeBridge");
        log("Copyright © 2019 by Stephane Clavel - forked from Daan Kets version, released under LGPLv3 License");
        if (!homebridge) {
            log("ERROR: Homebridge v0.2 or higher required!");
            return;
        }
        if (!config) {
            log("WARNING: no configuration");
            return;
        }
        this.log = log;
        this.config = config;
        this.homebridge = homebridge;

        this.accessories = new Map();

        this.roomnames = new Map();
        if (!this.config.rooms)
            this.log("WARNING: no room defined - no homeKit accessory will be created");
        else for (var roomname in this.config.rooms)
            this.config.rooms[roomname].forEach((alias) => this.roomnames.set(alias, roomname));

        homebridge.on("didFinishLaunching", () => {
            this.start();
            this.log("Finished launching!");
        });
    }

    configureAccessory(accessory) {
        this.log("cached accessory", accessory.displayName);
        let isInConfig = false;
        if (this.config.agreggate == "all")
            isInConfig = (accessory.displayName == "Neuron");
        else if (this.config.agreggate == "room")
            isInConfig = (this.config.rooms[accessory.context.alias] != null);
        else
            isInConfig = this.roomnames.has(accessory.context.alias);

        if (isInConfig)
            this.accessories.set(accessory.displayName, accessory);
        else {
            this.log("not in config anymore. removing");
            this.homebridge.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }
    }    

    // start/stop EVOK api

    start() {
        this.evok = new Evok({
            host: (this.config.connection && this.config.connection.host ? this.config.connection.host : "localhost"),
            restPort: (this.config.connection && this.config.connection.port ? this.config.connection.port : 80),
            wsPort: (this.config.connection && this.config.connection.wsPort ? this.config.connection.wsPort : 8080)
        });

        this.resetWatchDog();
        this.connected = false;

        this.evok
            .on("connected", () => {
                this.connected = true;

                if (!this.circuits) {
                    this.circuits = new Map();
                    this.evok.devices().forEach((event) => this.initEvok(event));
                }
                else {
                    this.dryRun = true;
                    this.evok.devices().forEach((event) => this.processEvokEvent(event));
                    this.dryRun = false;
                }

                this.startWatchDog();
            })
            .on("error", (error) => {
                this.log("Connection error", error, error.stack);
                this.stop();
                this.reconnect();
            })
            .on("message", (message, previous = {}) => {
                message.forEach((event) => this.processEvokEvent(event));
            });

        this.reconnect();
    }

    startWatchDog() {
        this.log("Starting watchdog");
        this.watchDogInterval = setInterval(() => {
            this.watchDogCounter++;
            if (this.watchDogCounter > 24) {
                this.log("Communication watchdog triggered: Resetting connection!")
                this.stop();
                this.start();
            }
        }, 60 * 60 * 1000);
    }

    resetWatchDog() {
        this.watchDogCounter = 0;
    }

    reconnect() {
        try {
            this.evok.connect();
        }
        catch (error) {
            this.log("Problem connecting to UniPi device. Reconnecting in 10s...", error, error.stack);
            setTimeout(() => { this.reconnect(); }, 10000);
        }
    }

    stop() {
        try {
            clearInterval(this.watchDogInterval);
            this.evok.close();
        }
        catch (error) {
            this.log("Error while disconnecting. Connection may already be closed.");
        }
        this.connected = false;
    }

    // create circuits, accessories and services

    alias2Name(alias) {
        return alias.replace(/_/g," "); // underscore is not a valid character for homeKit names
    }

    createAccessory(alias, room) {
        let name = this.alias2Name(alias);
        let accessory = this.accessories.get(name);
        if (!accessory) {
            let uuid = this.homebridge.hap.uuid.generate(name);
            accessory = new this.homebridge.platformAccessory(name, uuid);
            accessory.context.alias = alias;
            accessory.context.room = room;
            this.homebridge.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            this.accessories.set(name, accessory);
        }
        accessory.getService(this.homebridge.hap.Service.AccessoryInformation)
            .setCharacteristic(this.homebridge.hap.Characteristic.Manufacturer, "UniPi")
            .setCharacteristic(this.homebridge.hap.Characteristic.Model, "Neuron");
        accessory.on('identify', (paired, callback) => {
            this.log(accessory.context.room, accessory.context.alias);
            callback();
        });            
        return accessory;
    }

    createService(accessory, serviceType, serviceName) {
        let name = this.alias2Name(serviceName);
        let service = null;
        if (this.config.agreggate == "room" || this.config.agreggate == "all") {
            service = accessory.getServiceByUUIDAndSubType(serviceType.UUID, name);
            if (!service)
                accessory.addService(service = new this.homebridge.hap.Service.Switch(name, name));
        }
        else {
            service = accessory.getService(serviceType);
            if (!service)
                service = accessory.addService(serviceType, name);
        }
        return service;
    }

    initEvok(evok) {
        let type = this.evok2type(evok);
        if (!type)
            return;

        let alias = this.evok2alias(evok, type);
        if (!alias)
            return;

        let item = { type: type, address: evok.circuit, alias: alias };
        this.circuits.set(alias, item);
//        this.log(`adding ${type} ${alias}: ${evok.circuit}`);

        switch (type) {
            case 'AO':
                item.inverted = this.config.config[alias] && this.config.config[alias].inverted;
                item.toEvok = function () { return item.onoff ? Math.min(10, Math.max(0, (item.inverted ? (10 - item.value / 10) : (item.value / 10)))) : 0; };
                item.fromEvok = function (v) { let value = Math.min(100, Math.max(0, (item.inverted ? (100 - v * 10) : (v * 10)))); item.value = value ? value : 100; item.onoff = (value > 0); }
                item.fromEvok(evok.value, true);
                break;
            case 'AI':
                item.inverted = this.config.config[alias] && this.config.config[alias].inverted;
                item.sensibility = this.config.config[alias] && this.config.config[alias].sensibility ? this.config.config[alias].sensibility : 1;
                item.toEvok = function () { return Math.min(10, Math.max(0, (item.inverted ? (10 - item.value / 10) : (item.value / 10)))); };
                item.fromEvok = function (v) { item.value = Math.min(100, Math.max(0, (item.inverted ? (100 - v * 10) : (v * 10)))); }
                item.fromEvok(evok.value);
                break;
            case 'DI':
            case 'DO':
            case 'RO':
                item.value = evok.value;
                break;
        }

        // only add to HomeKit the devices that are explicetly in a room
        let roomname = this.roomnames.get(alias);
        if (!roomname)
            return;

        let accessory = null;
        if (this.config.agreggate == "all")
            accessory = this.createAccessory("Neuron", "Neuron");
        else if (this.config.agreggate == "room")
            accessory = this.createAccessory(roomname, roomname);
        else
            accessory = this.createAccessory(alias, roomname);

        let service = null;
        switch (type) {
            case 'RO':
                service = this.createService(accessory, this.homebridge.hap.Service.Switch, alias);
                service.getCharacteristic(this.homebridge.hap.Characteristic.On)
                    .on("get", (done) => this.getRelayOutputState(item, done))
                    .on("set", (state, done) => this.setRelayOutputState(item, state, done))
                    .updateValue(item.value);
                break;
            case 'DO':
                service = this.createService(accessory, this.homebridge.hap.Service.Switch, alias);
                service.getCharacteristic(this.homebridge.hap.Characteristic.On)
                    .on("get", (done) => this.getDigitalOutputState(item, done))
                    .on("set", (state, done) => this.setDigitalOutputState(item, state, done))
                    .updateValue(item.value);
                break;
            case 'AO':
                service = this.createService(accessory, this.homebridge.hap.Service.Lightbulb, alias);
                service.getCharacteristic(this.homebridge.hap.Characteristic.On)
                    .on("get", (done) => this.safeCallback(done, null, item.onoff))
                    .on("set", (state, done) => {
                        item.onoff = state;
                        this.setAnalogOutputState(item, item.toEvok(), done);
                    })
                    .updateValue(item.onoff);
                service.getCharacteristic(this.homebridge.hap.Characteristic.Brightness)
                    .on("get", (done) => this.safeCallback(done, null, item.value))
                    .on("set", (value, done) => {
                        item.value = value;
                        this.setAnalogOutputState(item, item.toEvok(), done);
                    })
                    .updateValue(item.value);
                break;
        }
        item.service = service;
    }

    evok2type(evok) {
        switch (evok.dev) {
            case 'relay':
                if (evok.relay_type == 'physical')
                    return 'RO';
                else if (evok.relay_type == 'digital')
                    return 'DO';
                else
                    return null;
            case 'input':
                return 'DI';
            case 'ai':
                return 'AI';
            case 'ao':
                return 'AO';
        }
        return null;
    }

    evok2alias(evok, type) {
        let alias = this.config.aliases[type + ' ' + evok.circuit];
        if (alias)
            return alias;
        else if (evok.alias && evok.alias.substr(0, 3) == 'al_')
            return evok.alias.substr(3);
        else
            return evok.alias;
    }

    // evok event handlers

    processEvokEvent(evok) {
        this.resetWatchDog();

        let type = this.evok2type(evok);
        if (!type)
            return;
        let alias = this.evok2alias(evok, type);
        if (!alias)
            return;
        let circuit = this.circuits.get(alias);
        if (!circuit)
            return;

        switch (type) {
            case 'RO':
            case 'DO':
                circuit.value = evok.value;
                if (circuit.service)
                    circuit.service.getCharacteristic(this.homebridge.hap.Characteristic.On).updateValue(evok.value);
                this.processRuleIfAny(alias, evok.value ? "on" : "off");
                break;
            case 'AO':
                circuit.fromEvok(evok.value);
                if (circuit.service) {
                    circuit.service.getCharacteristic(this.homebridge.hap.Characteristic.On).updateValue(circuit.onoff);
                    circuit.service.getCharacteristic(this.homebridge.hap.Characteristic.Brightness).updateValue(circuit.value);
                }
                this.processRuleIfAny(alias, "change");
                break;
            case 'DI':
                if (circuit.value == evok.value)
                    return;
                circuit.value = evok.value;
                if (this.dryRun)
                    return;
                if (evok.value) {
                    this.log("CLICK", alias);
                    this.processRuleIfAny("click", alias);
                    if (circuit.dblClickTimer) {
                        clearTimeout(circuit.dblClickTimer);
                        circuit.dblClickTimer = null;
                        this.log("DOUBLE CLICK", alias);
                        this.processRuleIfAny("doubleclick", alias);
                        return;
                    }
                    circuit.longClickTimer = setTimeout(() => {
                        circuit.longClickTimer = null;
                        circuit.value = false;
                        this.log("LONG CLICK", alias);
                        this.processRuleIfAny("longclick", alias);
                    }, 1000);
                }
                else {
                    if (circuit.longClickTimer) {
                        clearTimeout(circuit.longClickTimer);
                        circuit.longClickTimer = null;
                    }
                    if (!circuit.dblClickTimer) {
                        circuit.dblClickTimer = setTimeout(() => {
                            circuit.dblClickTimer = null;
                            this.log("SINGLE CLICK", alias);
                            this.processRuleIfAny("singleclick", alias);
                        }, 500);
                    }
                }
                break;
            case 'AI':
                let old = circuit.value;
                circuit.fromEvok(evok);
                if (Math.abs(circuit.value, old) > circuit.sensibility)
                    this.processRuleIfAny("move", alias);
                break;
        }
    }

    // EVOK API communication

    assertConnected() {
        if (!this.connected)
            throw "not_connected";
    }

    setDigitalOutputState(circuit, state, done) {
        try {
            this.assertConnected();
            this.log("Setting Digital Output ", circuit.alias, " to ", state);
            this.evok.digitalOutput(circuit.address, state);
            circuit.value = state;
            this.safeCallback(done);
        } catch (error) {
            this.log("Error setting digital out state", circuit.address, error, error.stack);
            this.safeCallback(done, error);
        }
    }

    getDigitalOutputState(circuit, done) {
        try {
            this.assertConnected();
            circuit.value = this.evok.digitalOutput(circuit.address);
            this.log("Reading Digital Output", circuit.alias, "=", circuit.value);
            this.safeCallback(done, null, circuit.value);
        } catch (error) {
            this.log("Error reading digital out state", circuit.address, error, error.stack);
            this.safeCallback(done, error);
        }
    }

    setRelayOutputState(circuit, state, done) {
        try {
            this.assertConnected();
            this.log("Setting Relay Output", circuit.alias, "to", state);
            this.evok.relay(circuit.address, state);
            circuit.value = state;
            this.safeCallback(done);
        } catch (error) {
            this.log("Error setting relay state", circuit.address, error, error.stack);
            this.safeCallback(done, error);
        }
    }

    getRelayOutputState(circuit, done) {
        try {
            this.assertConnected();
            circuit.value = this.evok.relay(circuit.address);
            this.log("Reading Relay Output", circuit.alias, "=", circuit.value);
            this.safeCallback(done, null, circuit.value);
        } catch (error) {
            this.log("Error reading relay state", circuit.address, error, error.stack);
            this.safeCallback(done, error);
        }
    }

    setAnalogOutputState(circuit, state, done) {
        try {
            this.assertConnected();
            this.log("Setting Analog Output", circuit.alias, "to", state);
            this.evok.analogueOutput(circuit.address, state);
            this.safeCallback(done);
        } catch (error) {
            this.log("Error setting analog state", circuit.address, error, error.stack);
            this.safeCallback(done, error);
        }
    }

    // rule engine

    processRuleIfAny(event, alias) {
        if (this.dryRun)
            return;
        let test = event + ' ' + alias;
        if (!this.config.rules)
            return;
        this.config.rules.forEach((rule) => {
            if ((typeof rule.when == 'string' && rule.when == test) || (typeof rule.when == 'object' && rule.when.indexOf(test) != -1)) {
                this.log("Rule", test);
                let condition = this.checkRule(rule["if"]);
                this.doRule(rule[condition ? "then" : "else"]);
            }
        });
    }

    checkRule(action) {
        if (typeof action == 'undefined')
            return true;
        if (typeof action == 'object')
            return action.some((r) => { return this.checkRule(r) });
        if (typeof action != 'string') {
            this.log("RULE ERROR", typeof action);
            return false;
        }

        let [cmd, alias] = action.split(' ', 2);
        let circuit = this.circuits.get(alias);
        if (!circuit) {
            this.log("RULE ERROR - unknown circuit", alias);
            return false;
        }

        if (circuit.type == 'RO') {
            if (cmd == 'on')
                return circuit.value;
            else if (cmd == 'off')
                return !circuit.value;
        }
        else if (circuit.type == 'AO') {
            if (cmd == 'on')
                return circuit.onoff;
            else if (cmd == 'off')
                return !circuit.onoff;
        }
        return false;
    }

    doRule(action) {
        if (typeof action == 'undefined')
            return;
        if (typeof action == 'object') {
            action.forEach((r) => { this.doRule(r) });
            return;
        }
        if (typeof action != 'string') {
            this.log("RULE ERROR", typeof action);
            return;
        }

        let [cmd, alias, param] = action.split(' ', 3);

        if (cmd == 'ifft') {
            let url = 'https://maker.ifttt.com/trigger/' + alias + '/with/key/' + this.config.iftttKey;
            https.get(url, (resp) => {
                let data = '';
                resp.on('data', (chunk) => { data += chunk; });
                resp.on('end', () => { this.log(data); });
            }).on("error", (err) => { this.log("Error: " + err.message); });
            return;
        }

        let circuit = this.circuits.get(alias);
        if (!circuit) {
            this.log("RULE ERROR - unknown object", alias);
            return;
        }

        if (circuit.type == 'AO') {
            if (cmd == 'setval') {
                let src = this.circuits.get(param);
                if (!src) {
                    this.log("RULE ERROR - unknown object", param);
                    return;
                }
                circuit.value = src.value;
//				circuit.onoff = (circuit.value>0);
            }
            else if (cmd == 'set') {
                circuit.value = Math.min(100, Math.max(0, param));
                circuit.onoff = (circuit.value > 0);
            }
            else if (cmd == 'on' || cmd == 'off') {
                circuit.onoff = (cmd == 'on');
                if (circuit.onoff && !circuit.value)
                    circuit.value = 100;
            }
            else {
                this.log("RULE ERROR - unknown command", cmd);
                return;
            }
            this.setAnalogOutputState(circuit, circuit.toEvok());
        }
        else if (circuit.type == 'RO') {
            if (cmd == 'switch')
                this.setRelayOutputState(circuit, !circuit.value);
            else if (cmd == 'on' || cmd == 'off')
                this.setRelayOutputState(circuit, cmd == 'on');
            else if (cmd == 'timer') {
                if (circuit.timer) {
                    this.log("reset timer", alias);
                    clearTimeout(circuit.timer);
                }
                else {
                    this.log("set timer", alias);
                    circuit.timer = setTimeout(() => {
                        circuit.timer = null;
                        this.setRelayOutputState(circuit, false);
                        this.log("fire timer", alias);
                    }, param * 1000);
                }
            }
            else
                this.log("RULE ERROR - unknown command", cmd);
        }
        else if (circuit.type == 'DO')
            this.setDigitalOutputState(circuit, cmd == 'on');
    }

    safeCallback(cb, error, ...results) {
        try {
            if (cb) {
                cb(error, ...results)
            }
        } catch (error) {
            console.error("Error executing callback", error, error.stack);
        }
    }


}
