/**
 * Tracks what records are currently selected in a databound component.
 *
 * This is an abstract class and is not meant to be directly used. Databound UI widgets such as
 * {@link Ext.grid.Panel Grid} and {@link Ext.tree.Panel Tree} should subclass Ext.selection.Model
 * and provide a way to binding to the component.
 *
 * The abstract methods `onSelectChange` and `onLastFocusChanged` should be implemented in these
 * subclasses to update the UI widget.
 */
Ext.define('Ext.selection.Model', {
    extend: 'Ext.util.Observable',
    alternateClassName: 'Ext.AbstractSelectionModel',
    requires: ['Ext.data.StoreManager'],
    mixins: {
        bindable: 'Ext.util.Bindable'    
    },
    // lastSelected

    /**
     * @cfg {"SINGLE"/"SIMPLE"/"MULTI"} mode
     * Mode of selection.  Valid values are:
     *
     * - **"SINGLE"** - Only allows selecting one item at a time.  Use {@link #allowDeselect} to allow
     *   deselecting that item.  This is the default.
     * - **"SIMPLE"** - Allows simple selection of multiple items one-by-one. Each click in grid will either
     *   select or deselect an item.
     * - **"MULTI"** - Allows complex selection of multiple items using Ctrl and Shift keys.
     */

    /**
     * @cfg {Boolean} allowDeselect
     * Allow users to deselect a record in a DataView, List or Grid.
     * Only applicable when the {@link #mode} is 'SINGLE'.
     */
    allowDeselect: false,

    /**
     * @property {Ext.util.MixedCollection} [selected=undefined]
     * A MixedCollection that maintains all of the currently selected records.
     * @readonly
     */
    selected: null,

    /**
     * @cfg {Boolean} [pruneRemoved=true]
     * Remove records from the selection when they are removed from the store.
     *
     * **Important:** When using {Ext.toolbar.Paging paging} or a {@link Ext.data.Store#buffered sparsely populated (buffered) Store},
     * records which are cached in the Store's {@link #data collection} may be removed from the Store when pages change,
     * or when rows are scrolled out of view. For this reason `pruneRemoved` should be set to `false` when using a buffered Store.
     *
     * Also, when previously pruned pages are returned to the cache, the records objects in the page will be
     * *new instances*, and will not match the instances in the selection model's collection. For this reason,
     * you MUST ensure that the Model definition's {@link Ext.data.Model#idProperty idProperty} references a unique
     * key because in this situation, records in the Store have their **IDs** compared to records in the SelectionModel
     * in order to re-select a record which is scrolled back into view.
     */
    pruneRemoved: true,

    constructor: function(cfg) {
        var me = this;

        cfg = cfg || {};
        Ext.apply(me, cfg);

        me.addEvents(
            /**
             * @event
             * Fired after a selection change has occurred
             * @param {Ext.selection.Model} this
             * @param {Ext.data.Model[]} selected The selected records
             */
            'selectionchange',
            /**
             * @event
             * Fired when a row is focused
             * @param {Ext.selection.Model} this
             * @param {Ext.data.Model} oldFocused The previously focused record
             * @param {Ext.data.Model} newFocused The newly focused record
             */
            'focuschange'
        );

        me.modes = {
            SINGLE: true,
            SIMPLE: true,
            MULTI: true
        };

        // sets this.selectionMode
        me.setSelectionMode(cfg.mode || me.mode);

        // maintains the currently selected records.
        me.selected = new Ext.util.MixedCollection(null, me.getSelectionId);

        me.callParent(arguments);
    },

    // binds the store to the selModel.
    bindStore: function(store, initial){
        var me = this;
        me.mixins.bindable.bindStore.apply(me, arguments);
        if(me.store && !initial) {
            me.refresh();
        }
    },

    getStoreListeners: function() {
        var me = this;
        return {
            add: me.onStoreAdd,
            clear: me.onStoreClear,
            bulkremove: me.onStoreRemove,
            update: me.onStoreUpdate,
            load: me.onStoreLoad
        };
    },

    /**
     * Selects all records in the view.
     * @param {Boolean} suppressEvent True to suppress any select events
     */
    selectAll: function(suppressEvent) {
        var me = this,
            selections = me.store.getRange(),
            i = 0,
            len = selections.length,
            start = me.getSelection().length;

        me.bulkChange = true;
        for (; i < len; i++) {
            me.doSelect(selections[i], true, suppressEvent);
        }
        delete me.bulkChange;
        // fire selection change only if the number of selections differs
        me.maybeFireSelectionChange(me.getSelection().length !== start);
    },

    /**
     * Deselects all records in the view.
     * @param {Boolean} suppressEvent True to suppress any deselect events
     */
    deselectAll: function(suppressEvent) {
        var me = this,
            selections = me.getSelection(),
            i = 0,
            len = selections.length,
            start = me.getSelection().length;

        me.bulkChange = true;
        for (; i < len; i++) {
            me.doDeselect(selections[i], suppressEvent);
        }
        delete me.bulkChange;
        // fire selection change only if the number of selections differs
        me.maybeFireSelectionChange(me.getSelection().length !== start);
    },

    // Provides differentiation of logic between MULTI, SIMPLE and SINGLE
    // selection modes. Requires that an event be passed so that we can know
    // if user held ctrl or shift.
    selectWithEvent: function(record, e, keepExisting) {
        var me = this,
            selected = me.isSelected(record);

        switch (me.selectionMode) {
            case 'MULTI':
                if (e.ctrlKey && selected) {
                    me.doDeselect(record, false);
                } else if (e.shiftKey && me.lastFocused) {
                    me.selectRange(me.lastFocused, record, e.ctrlKey);
                } else if (e.ctrlKey) {
                    me.doSelect(record, true, false);
                } else if (selected && !e.shiftKey && !e.ctrlKey && me.selected.getCount() > 1) {
                    me.doSelect(record, keepExisting, false);
                } else if (!selected) {
                    me.doSelect(record, false);
                }
                break;
            case 'SIMPLE':
                if (selected) {
                    me.doDeselect(record);
                } else {
                    me.doSelect(record, true);
                }
                break;
            case 'SINGLE':
                // if allowDeselect is on and this record isSelected, deselect it
                if (me.allowDeselect && selected) {
                    me.doDeselect(record);
                // select the record and do NOT maintain existing selections
                } else {
                    me.doSelect(record, false);
                }
                break;
        }
    },

    /**
     * Selects a range of rows if the selection model {@link #isLocked is not locked}.
     * All rows in between startRow and endRow are also selected.
     * @param {Ext.data.Model/Number} startRow The record or index of the first row in the range
     * @param {Ext.data.Model/Number} endRow The record or index of the last row in the range
     * @param {Boolean} keepExisting (optional) True to retain existing selections
     */
    selectRange : function(startRow, endRow, keepExisting, dir){
        var me = this,
            store = me.store,
            selectedCount = 0,
            i,
            tmp,
            dontDeselect,
            records = [];

        if (me.isLocked()){
            return;
        }

        if (!keepExisting) {
            me.deselectAll(true);
        }

        if (!Ext.isNumber(startRow)) {
            startRow = store.indexOf(startRow);
        }
        if (!Ext.isNumber(endRow)) {
            endRow = store.indexOf(endRow);
        }

        // swap values
        if (startRow > endRow){
            tmp = endRow;
            endRow = startRow;
            startRow = tmp;
        }

        for (i = startRow; i <= endRow; i++) {
            if (me.isSelected(store.getAt(i))) {
                selectedCount++;
            }
        }

        if (!dir) {
            dontDeselect = -1;
        } else {
            dontDeselect = (dir == 'up') ? startRow : endRow;
        }

        for (i = startRow; i <= endRow; i++){
            if (selectedCount == (endRow - startRow + 1)) {
                if (i != dontDeselect) {
                    me.doDeselect(i, true);
                }
            } else {
                records.push(store.getAt(i));
            }
        }
        me.doMultiSelect(records, true);
    },

    /**
     * Selects a record instance by record instance or index.
     * @param {Ext.data.Model[]/Number} records An array of records or an index
     * @param {Boolean} [keepExisting=false] True to retain existing selections
     * @param {Boolean} [suppressEvent=false] True to not fire a select event
     */
    select: function(records, keepExisting, suppressEvent) {
        // Automatically selecting eg store.first() or store.last() will pass undefined, so that must just return;
        if (Ext.isDefined(records)) {
            this.doSelect(records, keepExisting, suppressEvent);
        }
    },

    /**
     * Deselects a record instance by record instance or index.
     * @param {Ext.data.Model[]/Number} records An array of records or an index
     * @param {Boolean} [suppressEvent=false] True to not fire a deselect event
     */
    deselect: function(records, suppressEvent) {
        this.doDeselect(records, suppressEvent);
    },

    doSelect: function(records, keepExisting, suppressEvent) {
        var me = this,
            record;

        if (me.locked || !me.store) {
            return;
        }
        if (typeof records === "number") {
            record = me.store.getAt(records);
            // No matching record, jump out
            if (!record) {
                return;
            }
            records = [record];
        }
        if (me.selectionMode == "SINGLE" && records) {
            record = records.length ? records[0] : records;
            me.doSingleSelect(record, suppressEvent);
        } else {
            me.doMultiSelect(records, keepExisting, suppressEvent);
        }
    },

    doMultiSelect: function(records, keepExisting, suppressEvent) {
        var me = this,
            selected = me.selected,
            change = false,
            i = 0,
            len, record;

        if (me.locked) {
            return;
        }


        records = !Ext.isArray(records) ? [records] : records;
        len = records.length;
        if (!keepExisting && selected.getCount() > 0) {
            if (me.doDeselect(me.getSelection(), suppressEvent) === false) {
                return;
            }
            // TODO - coalesce the selectionchange event in deselect w/the one below...
        }

        function commit () {
            selected.add(record);
            change = true;
        }

        for (; i < len; i++) {
            record = records[i];
            if (keepExisting && me.isSelected(record)) {
                continue;
            }
            me.lastSelected = record;

            me.onSelectChange(record, true, suppressEvent, commit);
        }
        if (!me.preventFocus) {
            me.setLastFocused(record, suppressEvent);
        }
        // fire selchange if there was a change and there is no suppressEvent flag
        me.maybeFireSelectionChange(change && !suppressEvent);
    },

    // records can be an index, a record or an array of records
    doDeselect: function(records, suppressEvent) {
        var me = this,
            selected = me.selected,
            i = 0,
            len, record,
            attempted = 0,
            accepted = 0;

        if (me.locked || !me.store) {
            return false;
        }

        if (typeof records === "number") {
            // No matching record, jump out
            record = me.store.getAt(records);
            if (!record) {
                return false;
            }
            records = [record];
        } else if (!Ext.isArray(records)) {
            records = [records];
        }

        function commit () {
            ++accepted;
            selected.remove(record);
        }

        len = records.length;

        for (; i < len; i++) {
            record = records[i];
            if (me.isSelected(record)) {
                if (me.lastSelected === record) {
                    me.lastSelected = selected.last();
                    if (me.lastFocused === record) {
                        me.setLastFocused(null);
                    }
                }
                ++attempted;
                me.onSelectChange(record, false, suppressEvent, commit);
            }
        }

        // fire selchange if there was a change and there is no suppressEvent flag
        me.maybeFireSelectionChange(accepted > 0 && !suppressEvent);
        return accepted === attempted;
    },

    doSingleSelect: function(record, suppressEvent) {
        var me = this,
            changed = false,
            selected = me.selected;

        if (me.locked) {
            return;
        }
        // already selected.
        // should we also check beforeselect?
        if (me.isSelected(record)) {
            return;
        }

        function commit () {
            me.bulkChange = true;
            if (selected.getCount() > 0 && me.doDeselect(me.lastSelected, suppressEvent) === false) {
                delete me.bulkChange;
                return false;
            }
            delete me.bulkChange;

            selected.add(record);
            me.lastSelected = record;
            changed = true;
        }

        me.onSelectChange(record, true, suppressEvent, commit);

        if (changed) {
            if (!suppressEvent && !me.preventFocus) {
                me.setLastFocused(record);
            }
            me.maybeFireSelectionChange(!suppressEvent);
        }
    },

    /**
     * Sets a record as the last focused record. This does NOT mean
     * that the record has been selected.
     * @param {Ext.data.Model} record
     */
    setLastFocused: function(record, supressFocus) {
        var me = this,
            recordBeforeLast = me.lastFocused;

        me.lastFocused = record;
         
        // Only call the changed method if in fact the selected record *has* changed.
        if (record !== recordBeforeLast) {
            me.onLastFocusChanged(recordBeforeLast, record, supressFocus);
        }
    },

    /**
     * Determines if this record is currently focused.
     * @param {Ext.data.Model} record
     */
    isFocused: function(record) {
        return record === this.getLastFocused();
    },


    // fire selection change as long as true is not passed
    // into maybeFireSelectionChange
    maybeFireSelectionChange: function(fireEvent) {
        var me = this;
        if (fireEvent && !me.bulkChange) {
            me.fireEvent('selectionchange', me, me.getSelection());
        }
    },

    /**
     * Returns the last selected record.
     */
    getLastSelected: function() {
        return this.lastSelected;
    },

    getLastFocused: function() {
        return this.lastFocused;
    },

    /**
     * Returns an array of the currently selected records.
     * @return {Ext.data.Model[]} The selected records
     */
    getSelection: function() {
        return this.selected.getRange();
    },

    /**
     * Returns the current selectionMode.
     * @return {String} The selectionMode: 'SINGLE', 'MULTI' or 'SIMPLE'.
     */
    getSelectionMode: function() {
        return this.selectionMode;
    },

    /**
     * Sets the current selectionMode.
     * @param {String} selMode 'SINGLE', 'MULTI' or 'SIMPLE'.
     */
    setSelectionMode: function(selMode) {
        selMode = selMode ? selMode.toUpperCase() : 'SINGLE';
        // set to mode specified unless it doesnt exist, in that case
        // use single.
        this.selectionMode = this.modes[selMode] ? selMode : 'SINGLE';
    },

    /**
     * Returns true if the selections are locked.
     * @return {Boolean}
     */
    isLocked: function() {
        return this.locked;
    },

    /**
     * Locks the current selection and disables any changes from happening to the selection.
     * @param {Boolean} locked  True to lock, false to unlock.
     */
    setLocked: function(locked) {
        this.locked = !!locked;
    },

    /**
     * Returns true if the specified row is selected.
     * @param {Ext.data.Model/Number} record The record or index of the record to check
     * @return {Boolean}
     */
    isSelected: function(record) {
        record = Ext.isNumber(record) ? this.store.getAt(record) : record;
        return this.selected.contains(record);
    },

    /**
     * Returns true if there are any a selected records.
     * @return {Boolean}
     */
    hasSelection: function() {
        return this.selected.getCount() > 0;
    },
    
    getSelectionId: function(record){
        var id = record.getId();
        if (!record.hasId()) {
            id = record.internalId;
        }
        return id;
    },
    
    pruneIf: function() {
        var me = this,
            store = me.store,
            selected = me.selected,
            toRemove = [],
            len = selected.length,
            i, item;

        if (me.pruneRemoved) {
            for (i = 0; i < len; i++) {
                item = selected.getAt(i);
                if (!this.storeHasSelected(item)) {
                    toRemove.push(item);
                }
            }
            if (toRemove.length) {
                for (i = 0, len = toRemove.length; i < len; i++) {
                    selected.remove(toRemove[i]);
                }
            }
        }
    },
    
    // We need this special check because we could have a model
    // without an idProperty. getById() is fast, so we use that
    // if possible, otherwise we need to check the internalId
    storeHasSelected: function(record){
        var store = this.store,
            records,
            len, id, i;
        
        if (record.hasId()) {
            return !!store.getById(record);
        } else {
            records = store.data.items;
            len = records.length;
            id = record.internalId;
            
            for (i = 0; i < len; ++i) {
                if (id === records[i].internalId) {
                    return true;
                }
            }
        }
        return false;
    },

    refresh: function() {
        var me = this,
            store = me.store,
            rec,
            toBeSelected = [],
            toBeReAdded = [],
            oldSelections = me.getSelection(),
            len = oldSelections.length,
            selection,
            change,
            i = 0,
            lastFocused = me.getLastFocused();

        // Not been bound yet.
        if (!store) {
            return;
        }

        // Add currently records to the toBeSelected list if present in the Store
        // If they are not present, and pruneRemoved is false, we must still retain the record
        for (; i < len; i++) {
            selection = oldSelections[i];
            if (store.indexOf(selection) !== -1) {
                toBeSelected.push(selection);
            }

            // Selected records no longer represented in Store must be retained
            else if (!me.pruneRemoved) {
                // See if a record by the same ID exists. If so, select it
                rec = store.getById(selection.getId());
                if (rec) {
                    toBeSelected.push(rec);
                }
                // If it does not exist, we have to re-add it to the selection
                else {
                    toBeReAdded.push(selection)
                }
            }
        }

        // there was a change from the old selected and
        // the new selection
        if (me.selected.getCount() != (toBeSelected.length + toBeReAdded.length)) {
            change = true;
        }

        me.clearSelections();

        if (store.indexOf(lastFocused) !== -1) {
            // restore the last focus but supress restoring focus
            me.setLastFocused(lastFocused, true);
        }

        if (toBeSelected.length) {
            // perform the selection again
            me.doSelect(toBeSelected, false, true);
        }

        // If some of the selections were not present in the Store, but pruneRemoved is false, we must add them back
        if (toBeReAdded.length) {
            me.selected.addAll(toBeReAdded);

            // No records reselected.
            if (!me.lastSelected) {
                me.lastSelected = toBeReAdded[toBeReAdded.length - 1];
            }
        }

        me.maybeFireSelectionChange(change);
    },

    /**
     * A fast reset of the selections without firing events, updating the ui, etc.
     * For private usage only.
     * @private
     */
    clearSelections: function() {
        // reset the entire selection to nothing
        this.selected.clear();
        this.lastSelected = null;
        this.setLastFocused(null);
    },

    // when a record is added to a store
    onStoreAdd: Ext.emptyFn,

    // when a store is cleared remove all selections
    // (if there were any)
    onStoreClear: function() {
        if (this.selected.getCount() > 0) {
            this.clearSelections();
            this.maybeFireSelectionChange(true);
        }
    },

    // prune records from the SelectionModel if
    // they were selected at the time they were
    // removed.
    onStoreRemove: function(store, records, indexes) {
        var me = this,
            selected = me.selected,
            i, length = records.length,
            record, removed;

        if (me.locked || !me.pruneRemoved) {
            return;
        }

        // Deselect records which were removed
        for (i = 0; i < length; i++) {
            record = records[i];
            if (selected.remove(record)) {
                if (me.lastSelected == record) {
                    me.lastSelected = null;
                }
                if (me.getLastFocused() == record) {
                    me.setLastFocused(null);
                }
                ++removed;
            }
        }
        if (removed) {
            me.maybeFireSelectionChange(true);
        }
    },

    /**
     * Returns the count of selected records.
     * @return {Number} The number of selected records
     */
    getCount: function() {
        return this.selected.getCount();
    },
    
    // Called when the contents of the node are updated, perform any processing here.
    onUpdate: Ext.emptyFn,

    // cleanup.
    destroy: Ext.emptyFn,

    // if records are updated
    onStoreUpdate: Ext.emptyFn,

    /**
     * @abstract
     * @private
     */
    onStoreLoad: Ext.emptyFn,

    // @abstract
    onSelectChange: Ext.emptyFn,

    // @abstract
    onLastFocusChanged: function(oldFocused, newFocused) {
        this.fireEvent('focuschange', this, oldFocused, newFocused);
    },

    // @abstract
    onEditorKey: Ext.emptyFn,

    // @abstract
    bindComponent: Ext.emptyFn,

    // @abstract
    beforeViewRender: Ext.emptyFn

});
