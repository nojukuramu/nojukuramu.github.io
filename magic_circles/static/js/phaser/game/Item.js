/**
 * Item - Inventory item class for Phaser RPG
 */
class Item {
    constructor(id, name, type, icon, data) {
        this.id = id;
        this.name = name;
        this.type = type;  // 'SCROLL', 'ITEM', etc.
        this.icon = icon;  // Emoji or texture key
        this.data = data || {};
    }
}
