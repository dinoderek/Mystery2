# Sessions

## Brief
The current landing page is the list of blueprints (mysteries) that can be started.

We want to add the functionality to:
- List and resume active sessions/games
- List and look at the logs of completed sessions/games

This document will use game/session interchangeably.

## Navigation

The user now lands on the landing page. 
The landing page has three options, selectable by inputting the correct number.

1. Start a new game
2. View a list of in progress game
3. View a list of completed games

Option 2 is disabled if there are no in progress games.
Option 3 is disabled if there are no completed games.

## View a list of in progress game

Lists all in progress games. Displays for each one (1) Mystery Title, (2) Number of turns left, (3) Last time played

The list is sorted by last time played.

The user can resume a session by inputting the number corresponding to the session.

The user can always navigate back to the landing page by using back on the browser or by typing 'b'

## Resuming an in progress game

This functionality should already be supported by the API, but we will need to test that it works correctly.

## View a list of completed games

Lists all completed games. Displays for each one (1) Mystery Title, (2) Outcome of the investigation, (3) Last time played

The list is sorted by last time played.

The user can view a session by selecting the game by inputting the number corresponding to the game.

The user can always navigate back to the landing page by using back on the browser or by typing 'b'

## Viewing a completed game

No particular functionality is needed here, apart from verifying that resume works correctly for completed games. 

We should be visualising the game as if it had just completed, with "press any key to go back" the only interaction possible. 