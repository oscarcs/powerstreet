# Specifications and planning document

This is a project to create a city builder. The gimmick is that it will be substantially more realistic than previous city builders. It should feel like something a bit closer to a grand strategy game or other 'spreadsheet simulator' genre than previous offerings.

Implementation is still at early stages, and many things still need quite a bit of work.

## Current status

We have implemented a basic prototype using Three.js that includes building rendering, some basic lighting, and very basic building and road editing tools. UI is facilitated by React, but we are not using react-three-fiber. We are simultaneously building a backend system, named 'worldsync'; the purpose of this is to enable real-time multiplayer. Tinybase is being used to help facilitate sync operations. Cloudflare Workers and Durable Objects are being used as the infrastructure layer.

The datastructures currently used to represent things like buildings are fairly tentative and some additional work could be done here to think about performance, live editing and sync, and so on.

## Next steps

We have some code in ~/Dev/viz (or at github.com/oscarcs/viz) which is from an earlier prototype of this system written using different libraries.
That project used deck-gl as a rendering engine. This simplified some things but made it necessary to perform operations in geographic coordinates (or convert between geographic and local coords) which made things overly complex.
We also wanted some of the additional flexibility granted by using Three.js.

The viz project, however, does include code for calculating city lots by subdividing the internal city block areas delimited by a street grid. At the moment, we are not currently calculating the street grid correctly in this project and we need to put some thought into a solution that will combine fast datastructures with the ability to calculate city blocks and lots efficiently (which presumably includes avoiding recalculation until a street node changes). The previous code is in the /procgen directory of the viz project.

We need to get a prototype of the backend working at some point to test multiplayer functionality (and performance).

We also need to start implementing some game mechanics. I want this to be a realistic simulation of real world zoning laws, which would include things like:
- Building height restrictions
- Height in relation to boundary rules (i.e. setback laws)
- Floor area ratios
- Allowed land uses (which should include mixed use - different rules for each building 'section')
One implementation pathway here is probably to make these things sliders or dropdowns in the UI that can be changed and then regenerate a building (or buildings) to reflect the rules. Later there will be more detailed mechanics about how these things can change but that would be a good proof of concept.

Roads need to be of adjustable width (and therefore throughput) and we need to create rendering code that will facilitate this. We'll also need to think about how we're going to implement overpasses, flyovers, elevated freeways, and so on. This system should be suffiently generalisable and polymorphic such that we can reuse it to implement transit systems like metros, light rail, or pedestrian overpasses.

At the moment the world is a flat single fixed size tile:
- We need to think about how elevated terrain and water is going to work, which should include tools to edit these things. One possible approach I have thought about is that we could do something similar to old school games like SimCity 4 and have a grid of points that can be adjusted up and down and then render a surface between those points. We would then have a sea level and render water at heights below that.
- We need to consider how to make the world bigger. Probably using some kind of tile or grid system but I haven't thought deeply about performant ways to do this.
- We will need to think about rendering and shadowing in bigger maps.

There will be a core simulation layer to perform statistical simulations of traffic flow, job demand, as well as corresponding visualisations. Not a priority right now as we are implementing core engine functionality first, but we should be aware that this is the next step.