I want to create the first iteration of the WebUI for the game. 

In terms of functionality, I want the WebUI to support the game loop, as described in the specs and as implemented in the current API spec / tests.

# Styling:
* The WebUI should have a terminal-like feeling. 
* It should be completely controllable via keyboard. 
* It should use simple "boxes" plus text and colors and accents to convey the information 
* It should work on a variety of screen sizes, including mobile. 

# Screens
Just two screens
* Game start: show list of blueprints, choose a blueprint by typing the number.
* Game session: described below

# Out of scope
* Note that we have not implemented the functionality to list currently running or historical game sessions, so this functionality is out of scope.
* Note that we have not implemented accounts, so that is out of scope as well.

# Game session screen
Divided into horizontal sections described below in order

## Header
Display the title of the current blueprint

## Narration box
Displays the current narration.

A narration is basically a list of "fragments" such as "investigator: search", "narrator: you find a body", "character: the butler did it". 

Each fragment should be displayed in a box, with the actor name at the top. If the current API does not convery the actor, consider either specifying it in the API or inferring in the Web UI. 

Every time a new fragment is added, it should be displayed in a new box, below the previous fragments and we should auto scroll to the bottom of the narration box.

While we are waiting for backend to respond, the box should show a loading indicator - the indicator should be made with text (for example moving dots, ascii spinner, etc). In the first iteration we could have a small collection and choose randomly.

The narration box can be scrolled with the up and down arrow. 

## Status bar
Displays: 
* Current location
* Characters at the location
* Current turns remaining
* Hints, such as Help command 

## Input box

Displays a text input for the user to type their action. 
The text input should be primed with the current mode: 
- Normal mode - just hint "what do you want to do next? Move, Search, Talk..."
- Talking to X - hint "what do you want to say to X?"
- Accusation - hint "who do you want to accuse?"

## Help

There should be a help command. The help command should display a terminal style Help modal with the commands and examples. 