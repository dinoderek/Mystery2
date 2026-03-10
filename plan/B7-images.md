Add AI based image generation to the mystery. 

There are two image generation paths that we can tale
* Offline: generated off the blueprint, pre-upload to supabase
* Online: generated off the blueprint plus player actions, on-the-fly generation, within session caching to avoid re-generation and optimise latency

Eventually we probably want a combination of both capabilities. Dynamic is good when stories become more dynamic and/or when we want the user to be able to tweak appearance / introudce his own character.

Static is cheaper, faster, better experience.


Components of the change:
* Blueprints now specify the overall artistic style and mood of the mystery.

