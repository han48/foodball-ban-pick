# PickUp — Football Draft

React app for drafting a football squad and arranging players on a pitch. Room signaling is provided by the Laravel app in `132.one`.

## Run locally

Start the Laravel app so the signaling API is available at `http://127.0.0.1:13280`, then in this directory:

```sh
bun install
bun run dev
```

Set `LARAVEL_ORIGIN` if the local Laravel server uses a different origin.

## Play with another captain

1. The room owner creates a room and shares the generated link with participants.
2. Participants open the link, enter a required display name, and join. More participants can join as viewers.
3. The room owner selects two distinct participants as captains. The draft is enabled for those captains after confirmation; the owner may also select themselves.

The Laravel API at `/api/office-game/signal` manages room presence and relays only WebRTC connection setup messages (SDP/ICE). After a peer connection opens, draft state, captain assignments, and captain actions use WebRTC DataChannels: participants send actions to the host, and the host forwards the resulting state to connected participants. Draft data is not relayed or stored by the Laravel API.

Draft rooms have no fixed participant cap, though each participant needs a separate WebRTC connection to the host. A public STUN server is used for ICE setup; users behind restrictive NATs or firewalls may need a TURN service for reliable connectivity. Room presence expires after participants leave or become inactive, so rooms are not saved matches.

The room owner manages the room, uploads the player CSV, and updates player/team information. Only the two selected captains can pick or arrange players. The opening pick is one player, then captains alternate two picks each.

## Publish with `132.one`

From this directory, run `bun run build`. Vite writes the app to `132.one/public/football-draft`; the Laravel app serves it at `/football-draft`. Deploy the Laravel changes and the generated public build together.
