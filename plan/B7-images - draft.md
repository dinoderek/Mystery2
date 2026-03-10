# Static story images

## In this change

We want to introuduce *static* blueprint images. 

* Blueprints store references to images.
* Images are generated on the local machine by the operator.
* Images + Blueprint are deployed from the local machine by the operator - same as how currently blueprint are pusheed.
* Application displays the blueprint images. Only authenticated users can fetch images. 

## Data changes

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

## Application changes

### Serving images
We must have a mechanism to serve images to the browser. 
Given an `ImageID` we want to be able to serve the image to the frontend.
The simplest approach would be to provide a link to the frontend to render but open to other options
Image fetch must require authentication to prevent abuse.

### Visual changes
IF the blueprint provides an image, the image should be displayed to the side of the narration. 

The location image should be displayed on `move to`
The character image should be displaeyd on `talk to`
The blueprint image should be displayed in the `select blueprint` screen

If no image is available either do not display anything or use a placeholder. We nee to test both options.

### Generation
Create a tool to genrate images and patch them in the blueprint.

On the local machine the operator has access to a tool that allows him to generate image for a blueprint:
- It takes the stylistic directorion from the blueprint
- It takes one or more images to generate (all images in the blueprint, one or more locations, one or more characters, the blueprint icon)
- Generates the images using OpenRouter
    - Need mechanism to specify the model to use
    - Generate prompt using the location / character / blueprint description
- Patches the ImageIDs so that they reference the newly generated images.

ImageID can be as simple as a `blueprintname-uuid` and the image filename can be used for linking.

Generated images SHOULD NOT be committed to github. Assume the operator needs to specify an image directory to fetch/generate images to.

## Deployment utilities
A utility to deploy images and blueprint together to the backend. Extend the current deployment utility to deploy the images as well.

## Backwards compatibility
* Images should NOT be mandatory
* Both deployment and serving should work when the blueprint has no images or images are missing.