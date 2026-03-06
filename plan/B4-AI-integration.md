I want to integrate the AI with the backend.

#1 Key components:
- Basic OpenRouter integration 
- Basic OpenRouter configuration - (secure load API key and model from environment file)
- Define different AI roles
- For each role define a prompt (static), story input (dynamic) and output (dynamic, constrained to spec)
- Create e2e and integration tests that leverage real AI 
    - NOT covered by ALL as it uses money and is BRITTLE 
    - Two modes of execution, with our default AI choice (google/gemini-3-flash-preview)  or with a free model. (z-ai/glm-4.5-air:free)
    - Uses a predefined case and a predefined "investigator script" 

# Interaction with AI
The key here is that I want to maximise the possiblity for the AI to do "the right thing".

Key principles:
- Role specific prompt
- Input to AI should be
    - Role prompt
    - Enough information to perfom the role, but minimising chance of leaking information
- Output from AI should be constrained to well known schema.

## Information always shared with AI

Always share:

- High level mystery context 
    - What is the mystery
    - What are the locations
    - What are the characeters
- Target age
    - Reading level, content

## Talk: game-talk / game-ask / game-end-talk

Three steps:
1. Start: AI generates flavour text based on character description and previous convos
    - Input: character, location, previous conversations (`talk-pack`)
    - Output: brief text describing the investigator appraoching the character and the character itself
    - Prompt: `talk-start`
2. Talk: AI genrates the responses for the character
    - Input: character, location, previous conversation (`talk-pack`) + `player input`
    - Output: what the character replies, description of how the player reats...
    - Prompt: `talk-conversation`
3. End: 
    - Input: character, location, previous conversations
    - Output: brief text describing how the interaction ends, how the character feels about theconversation
    - Prompt: `talk-end`   

Talk is the most important interaction of the game from a gameplay and engagemnt standpoint! We should ensure that the `talk-conversation` prompt is as good as we can.

## Search: game-search

- Input: location
- Output: brief text describing the investigator searching and what is found
- Prompt: `talk-start`

Search will be expanded in the future, but for now it is a pretty basic interaction.

## Accuse: game-accuse

Note: this whole action might need revisiting. We need to verify the current state of the API and the game logic and refine it. 

This SHOULD be a two stage process where:

1. Start accusation
    - Input: NONE (or accusation setting if we add to the blueprint)
    - Output: Brief description of the setting for the accusation. Classical whodunnit... 
    - Prompt `accusation-start`
2. Accusation rounds
    - Input: full mystery information, full interaction history, player input
    - Output: can be either that the player solved the mystery, failed to solve the mystery, or more question to the player to probe the solution
    - Prompt: `accusation-judge`

Feel free to add for more clarifying questions!


# Test Investigator script
- Should aim to simulate a real user
    - Send some wrong commands
    - Ask for locations and characters and help
- Should solve the case within the alloted time following a plausible route

# Keep documentation up to date
All docs but in particular:
- game.md with the game decisions
- API schema supabase/functions/_shared/blueprints/blueprint-schema.ts
- generator prompt in  supabase/functions/_shared/blueprints/generator-prompt.md