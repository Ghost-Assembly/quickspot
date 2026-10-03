// SPDX-License-Identifier: GPL-3.0-or-later
// Export desktop media controls from the service, independent of Shell's lifetime.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const MPRIS_NAME = 'org.mpris.MediaPlayer2.quickspot';
export const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER = 'org.mpris.MediaPlayer2.Player';
const ROOT_XML = `<node><interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/><method name="Quit"/>
    <property name="CanQuit" type="b" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="HasTrackList" type="b" access="read"/>
    <property name="Identity" type="s" access="read"/>
    <property name="SupportedUriSchemes" type="as" access="read"/>
    <property name="SupportedMimeTypes" type="as" access="read"/>
</interface></node>`;
const PLAYER_XML = `<node><interface name="${PLAYER}">
    <method name="Next"/><method name="Previous"/><method name="Pause"/>
    <method name="PlayPause"/><method name="Stop"/><method name="Play"/>
    <method name="Seek"><arg type="x" direction="in" name="Offset"/></method>
    <method name="SetPosition"><arg type="o" direction="in" name="TrackId"/><arg type="x" direction="in" name="Position"/></method>
    <method name="OpenUri"><arg type="s" direction="in" name="Uri"/></method>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Rate" type="d" access="readwrite"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Volume" type="d" access="readwrite"/>
    <property name="Shuffle" type="b" access="readwrite"/>
    <property name="Position" type="x" access="read"/>
    <property name="MinimumRate" type="d" access="read"/>
    <property name="MaximumRate" type="d" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanControl" type="b" access="read"/>
</interface></node>`;

export class MprisBridge {
    constructor(client, { bus = Gio.DBus.session } = {}) {
        this._client = client;
        this._bus = bus;
        this._owner = 0;
        this._root = null;
        this._player = null;
        this._last = new Map();
    }

    sync() {
        if (!this._client.state.connected || !this._client.state.loggedIn) {
            this._unexport();
            return;
        }
        if (!this._owner) {
            this._root = Gio.DBusExportedObject.wrapJSObject(ROOT_XML, {
                Raise() {},
                Quit() {},
                CanQuit: false,
                CanRaise: false,
                HasTrackList: false,
                Identity: 'QuickSpot',
                SupportedUriSchemes: ['spotify'],
                SupportedMimeTypes: [],
            });
            this._player = Gio.DBusExportedObject.wrapJSObject(PLAYER_XML, this);
            this._root.export(this._bus, MPRIS_PATH);
            this._player.export(this._bus, MPRIS_PATH);
            this._owner = Gio.bus_own_name_on_connection(
                this._bus,
                MPRIS_NAME,
                Gio.BusNameOwnerFlags.NONE,
                null,
                null,
            );
        }
        const values = new Map([
            ['PlaybackStatus', new GLib.Variant('s', this.PlaybackStatus)],
            ['Metadata', new GLib.Variant('a{sv}', this.Metadata)],
            ['Volume', new GLib.Variant('d', this.Volume)],
            ['Shuffle', new GLib.Variant('b', this.Shuffle)],
            ['CanPlay', new GLib.Variant('b', this.CanPlay)],
            ['CanPause', new GLib.Variant('b', this.CanPause)],
            ['CanGoNext', new GLib.Variant('b', this.CanGoNext)],
            ['CanGoPrevious', new GLib.Variant('b', this.CanGoPrevious)],
        ]);
        for (const [name, value] of values) {
            if (!this._last.get(name)?.equal(value))
                this._player.emit_property_changed(name, value);
        }
        this._last = values;
    }

    get PlaybackStatus() {
        if (!this._client.state.active) return 'Stopped';
        return this._client.state.status === 'playing'
            ? 'Playing'
            : this._client.state.status === 'paused' ||
                this._client.state.status === 'buffering'
              ? 'Paused'
              : 'Stopped';
    }
    get Metadata() {
        const state = this._client.state;
        if (!state.active || !state.uri) return {};
        const id = GLib.compute_checksum_for_string(
            GLib.ChecksumType.SHA256,
            state.uri,
            -1,
        );
        return {
            'mpris:trackid': new GLib.Variant(
                'o',
                `/org/ghostassembly/QuickSpot/track/${id}`,
            ),
            'mpris:length': new GLib.Variant(
                'x',
                Math.round((state.duration ?? 0) * 1000),
            ),
            'xesam:url': new GLib.Variant('s', state.uri),
            'xesam:title': new GLib.Variant('s', state.title),
            'xesam:artist': new GLib.Variant('as', state.artist ? [state.artist] : []),
        };
    }
    get Volume() {
        return this._client.state.volume / 100;
    }
    get Shuffle() {
        return this._client.state.shuffle === true;
    }
    set Shuffle(value) {
        if (typeof value !== 'boolean') throw new Error('Invalid shuffle setting.');
        void this._client.setShuffle(value).catch(() => {});
    }
    set Volume(value) {
        if (!Number.isFinite(value) || value < 0 || value > 1)
            throw new Error('Volume must be between 0 and 1.');
        void this._client.setVolume(value * 100).catch(() => {});
    }
    get Position() {
        const state = this._client.state;
        if (!state.active || !state.position) return 0;
        const { position_ms: anchor, timestamp_ms: timestamp, speed } = state.position;
        const elapsed =
            state.status === 'playing'
                ? Math.max(0, Date.now() - timestamp) * speed
                : 0;
        return Math.round(
            Math.min(state.duration || 86400000, anchor + elapsed) * 1000,
        );
    }
    get Rate() {
        return 1;
    }
    set Rate(value) {
        if (value !== 1) throw new Error('Only normal playback speed is supported.');
    }
    get MinimumRate() {
        return 1;
    }
    get MaximumRate() {
        return 1;
    }
    get CanControl() {
        return true;
    }
    get CanPlay() {
        return this._client.state.loggedIn;
    }
    get CanPause() {
        return this._client.state.active && this._client.state.status !== 'idle';
    }
    get CanGoNext() {
        return this.CanPause;
    }
    get CanGoPrevious() {
        return this.CanPause;
    }
    get CanSeek() {
        return false;
    }
    Seek() {}
    SetPosition() {}

    _command(invocation, command, uri = null) {
        void this._client.command(command, uri).then(
            () => invocation.return_value(null),
            () =>
                invocation.return_dbus_error(
                    'org.mpris.MediaPlayer2.Error.Failed',
                    'QuickSpot could not complete playback. Check pairing and device state.',
                ),
        );
    }
    PlayAsync(_args, invocation) {
        this._command(invocation, 'play');
    }
    PauseAsync(_args, invocation) {
        this._command(invocation, 'pause');
    }
    StopAsync(_args, invocation) {
        this._command(invocation, 'pause');
    }
    NextAsync(_args, invocation) {
        this._command(invocation, 'skip_next');
    }
    PreviousAsync(_args, invocation) {
        this._command(invocation, 'skip_prev');
    }
    PlayPauseAsync(_args, invocation) {
        this._command(invocation, this.PlaybackStatus === 'Playing' ? 'pause' : 'play');
    }
    OpenUriAsync([uri], invocation) {
        this._command(invocation, 'play', uri);
    }

    _unexport() {
        if (this._owner) Gio.bus_unown_name(this._owner);
        this._owner = 0;
        this._root?.unexport();
        this._player?.unexport();
        this._root = null;
        this._player = null;
        this._last.clear();
    }
    destroy() {
        this._unexport();
    }
}
