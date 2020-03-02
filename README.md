# homebridge-unipi2
Hombridge plugin for UniPi Neuron PLC

Loosely based on Daan Kets original work, but with:

- support for one-accessory per relay, or one-accessory per room with relays as different services, or one accessory with all relays as services
- support for UniPi extensions modules (xS modules)
- support for persistent aliases in the config.json (so Neuron module can be reseted without loosing informations)
- support for complex rules (if/then/else with group conditions, actions to on/off relays, et analog outputs, process short/long/double clicks, or even call ifttt receipes)


Example config file:
  "platforms": [
    {
      "platform": "UniPi2",
      "id": "L203-sn250",
      "name": "My SmartHome",

      "aliases": {
        "DI 1_01": "in_switch1",
        "DI 1_02": "in_switch2",
        "DI UART4_6_08": "in_doorbell",
        "AI UART2_4_01": "in_rotary1",
        "DO 1_01": "led1",
        "DO 1_02": "led2",
        "RO 2_01": "light1",
        "RO 2_02": "light2",
        "AO UART2_4_01": "dimmer1",
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
