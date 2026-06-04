/**
 * Item - Inventory item class
 */
class Item {
    constructor(id, name, type, icon, data) {
        this.id = id;
        this.name = name;
        this.type = type;
        this.icon = icon;
        this.data = data || {};
    }
}
