# homebridge-unipi2

Hombridge plugin for UniPi Neuron PLC
Optimized for SmartHome usage.

Loosely based on [Daan Kets](https://github.com/blackbit-consulting/homebridge-unipi) original work, but with:

- support for one accessory per relay, or one accessory per room with relays as different services, or one accessory with all relays as services
- support for UniPi extensions modules (xS modules)
- support for persistent aliases in the config.json (so Neuron module can be reseted without loosing informations)
- support for complex rules (if/then/else with group conditions, actions to on/off relays, set analog outputs, process short/long/double clicks, or even call ifttt receipes)


Example config file:
```json
    "platforms": [
    {
      "platform": "UniPi2",
      "id": "L203-sn250",
      "name": "My SmartHome",
    
      "aliases": {
        "DI 1_01": "in_switch1",
        "DI 1_02": "in_switch2",
        "DI UART_4_6_08": "in_doorbell",
        "AI UART_2_4_01": "in_rotary1",
        "DO 1_01": "led1",
        "DO 1_02": "led2",
        "RO 2_01": "light1",
        "RO 2_02": "light2",
        "AO UART_2_4_01": "dimmer1",
      },

      "rooms": {
        "living": [ "light1", "light2", "dimmer1" ],
        "leds": [ "led1", "led2" ]
      },

      "iftttKey": "xxxxxxxx",
      "config": {
        "dimmer1": { "inverted": true }
      },

      "rules": [
        {
          "when": "click in_doorbell",
          "then": "ifft doorbell"
        },
        {
          "when": "click in_switch1",
          "if": "off light1",
          "then": "on light1",
          "else": [ "off light1", "off light2", "off dimmer1" ]
        },
        {
          "when": "singleclick in_switch2",
          "if": [ "on light1", "on light2", "on dimmer1" ],
          "then": [ "off light1", "off light2", "off dimmer1" ],
          "else": "switch light2"
        },
        {
          "when": "doubleclick in_switch2",
          "then": [ "off light1", "off light2", "off dimmer1" ]
        },
        {
          "when": "move in_rotary1",
          "then": "setval dimmer1 in_rotary1"
        }

      ]
    }
  ]
```


# Installation:

1) Install UniPian OS image on the Neuron's SD card
- Download the [UniPian image](https://kb.unipi.technology/en:files:software:os-images:00-start) (called "Neuron OpenSource OS")
- Download [balenaEtcher](https://www.balena.io/etcher/) and install it
- Connect the SD card to your PC, run balenaEtcher, and write the UniPian image to the SD card
- Create an empty file called `ssh` (without extensions) at the root of the SD card
- put the SD card into the Neuron and power it up

2) Update all packages
Connect to the Neuron using a SSH client, then type:
```
sudo apt-get update
sudo apt-get upgrade
sudo apt-get install evok
sudo systemctl enable evok
reboot
```

3) Install homebridge
```
curl -sL https://deb.nodesource.com/setup_12.x | sudo bash -
sudo apt-get install -y nodejs gcc g++ make python
sudo npm i -g npm
sudo npm install -g --unsafe-perm homebridge
sudo hb-service install --user homebridge
```

4) Install UniPi2 plugin
```
sudo npm -g install homebridge-unipi2
```

5) Configure Evok and Homebridge
- Edit the file `/etc/evok.conf`, make sure to set `device-name = ` to the correct devices for the extensions, if any
- Edit the file `/var/lib/homebridge/.homebridge/config.json` and add a platform "UniPi2" with all your rooms, devices, and rules

6) (optional) Install Config-UI-X plugin
```
sudo npm install -g homebridge-config-ui-x
```
This will let you edit the config.json file at will using a webbrowser
