"""Display-only projections; record, clipboard and CSV values remain canonical."""

from decimal import ROUND_HALF_UP, Decimal, localcontext


def format_value(field, value):
    if value is None:
        return ""
    config = field.config
    if field.type == "date":
        year, month, day = value.split("-")
        pattern = config.date_format or "YYYY-MM-DD"
        if pattern == "YYYY年M月D日":
            return f"{year}年{int(month)}月{int(day)}日"
        if pattern == "DD/MM/YYYY":
            return f"{day}/{month}/{year}"
        if pattern == "MM/DD/YYYY":
            return f"{month}/{day}/{year}"
        separator = "/" if pattern == "YYYY/MM/DD" else "." if pattern == "YYYY.MM.DD" else "-"
        return separator.join([year, month, day])
    if field.type == "number" and (config.decimal_places is not None or config.use_grouping):
        number = Decimal(str(value))
        grouping = "," if config.use_grouping else ""
        precision = f".{config.decimal_places}" if config.decimal_places is not None else ""
        with localcontext() as context:
            context.rounding = ROUND_HALF_UP
            return format(number, f"{grouping}{precision}f")
    return str(value)
