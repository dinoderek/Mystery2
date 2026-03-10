# Add AI based image generation to the mystery. 

There are two image generation paths that we can tale
* Offline: generated off the blueprint, pre-upload to supabase
* Online: generated off the blueprint plus player actions, on-the-fly generation, within session caching to avoid re-generation and optimise latency

Eventually we probably want a combination of both capabilities. Dynamic is good when stories become more dynamic and/or when we want the user to be able to tweak appearance / introudce his own character.

Static is cheaper, faster, better experience for the user, but requires us to pre-determine the set of available images and their style. 

We can also explore hybrid approaches, where static images are used when available, otherwise they are generated on the fly.

## In this change

We want to introuduce *static* blueprint images. 

### Blueprint change 
    * Add `art style`: See stylistic direction below
    * Add `image`: `ImageID` to show in the blueprint list
    * For each character
        * Add `portrait`: `ImageID` the portrait to display in the narration
    * For each location 
        * Add `location`: `ImageID` the location imagine to display in the narration

### Stylistic direction
* An artistic style such as
    * Cute 3D animated movie style, Octane render
    * Soft watercolor illustration, detailed line-art, storybook style
    * Layered papercraft, origami, pop-up book illustration
* A mood & atmosphere such as  
    * Silly and playful
    * Magical and Wondrous
    * Spooky / Cute
* Lighting
    * Soft Morning Sunbeams
    * Magical Bioluminescence
    * Bright Midday Sunshine
* Palette
    * Candy colored
    * Primary colors
    * Earthy and Natural    

### Serving images
We must have a mechanism to serve images to the browser. 
Given an `ImageID` we want to be able to serve the image to the frontend.
The simplest approach would be to provide a link to the frontend to render but open to other options
Image fetch must require authentication to prevent abuse.

### Generation utilities
A utility to generate images for a blueprint. This should be able to either generate one of the images necessary for the blueprint and patch the ID or all the images necessary for the bluepint. 

### Deployment utilities
A utility to deploy images together with blueprints to the backend.