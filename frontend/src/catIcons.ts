/**
 * 分类图标映射：按分类 id / icon 字段 / 标题 解析到 lucide 组件。
 * 系统默认分类 seed 时 icon 存大类名；二级分类无 icon 时按 id 细化或继承大类。
 */
import type { Component } from 'vue'
import {
  Utensils, UtensilsCrossed, Bus, ShoppingBag, Home, Film, Cross, GraduationCap, Gift, MoreHorizontal,
  Wallet, Trophy, TrendingUp, Coffee, CupSoda, Cookie, Wine, Car, Fuel, ParkingCircle,
  Signpost, Wrench, Shirt, SprayCan, Package, Smartphone, Sofa, Building2, Landmark,
  Droplets, Zap, Flame, Building, Wifi, Phone, Gamepad2, Plane, Dumbbell, Pill,
  Stethoscope, Hospital, Activity, Presentation, BookOpen, HeartHandshake, PawPrint,
  Percent, CandlestickChart, Briefcase,
} from 'lucide-vue-next'

/** icon 字段值 → lucide 组件 */
const CAT_ICONS: Record<string, Component> = {
  utensils: Utensils,
  'utensils-crossed': UtensilsCrossed,
  bus: Bus,
  car: Car,
  fuel: Fuel,
  'parking-circle': ParkingCircle,
  signpost: Signpost,
  wrench: Wrench,
  'shopping-bag': ShoppingBag,
  shirt: Shirt,
  'spray-can': SprayCan,
  package: Package,
  smartphone: Smartphone,
  sofa: Sofa,
  home: Home,
  'building-2': Building2,
  landmark: Landmark,
  droplets: Droplets,
  zap: Zap,
  flame: Flame,
  building: Building,
  wifi: Wifi,
  phone: Phone,
  film: Film,
  'gamepad-2': Gamepad2,
  plane: Plane,
  dumbbell: Dumbbell,
  cross: Cross,
  pill: Pill,
  stethoscope: Stethoscope,
  hospital: Hospital,
  activity: Activity,
  'graduation-cap': GraduationCap,
  presentation: Presentation,
  'book-open': BookOpen,
  gift: Gift,
  'heart-handshake': HeartHandshake,
  'more-horizontal': MoreHorizontal,
  'paw-print': PawPrint,
  wallet: Wallet,
  trophy: Trophy,
  'trending-up': TrendingUp,
  percent: Percent,
  'candlestick-chart': CandlestickChart,
  briefcase: Briefcase,
  coffee: Coffee,
  'cup-soda': CupSoda,
  cookie: Cookie,
  wine: Wine,
}

/** 二级分类 id → 细化图标（seed 默认分类） */
const CAT_ICONS_BY_ID: Record<string, Component> = {
  // 餐饮
  cat_exp_food_breakfast: Coffee,
  cat_exp_food_lunch: Utensils,
  cat_exp_food_dinner: UtensilsCrossed,
  cat_exp_food_drink: CupSoda,
  cat_exp_food_snack: Cookie,
  cat_exp_food_tobacco: Wine,
  cat_exp_food_takeout: ShoppingBag,
  // 交通
  cat_exp_transport_bus: Bus,
  cat_exp_transport_taxi: Car,
  cat_exp_transport_gas: Fuel,
  cat_exp_transport_park: ParkingCircle,
  cat_exp_transport_toll: Signpost,
  cat_exp_transport_repair: Wrench,
  // 购物
  cat_exp_shopping_clothes: Shirt,
  cat_exp_shopping_cosmetics: SprayCan,
  cat_exp_shopping_daily: Package,
  cat_exp_shopping_digital: Smartphone,
  cat_exp_shopping_home: Sofa,
  // 居住
  cat_exp_housing_rent: Building2,
  cat_exp_housing_mortgage: Landmark,
  cat_exp_housing_water: Droplets,
  cat_exp_housing_electric: Zap,
  cat_exp_housing_gas: Flame,
  cat_exp_housing_property: Building,
  cat_exp_housing_network: Wifi,
  cat_exp_housing_phone: Phone,
  // 娱乐
  cat_exp_entertainment_movie: Film,
  cat_exp_entertainment_game: Gamepad2,
  cat_exp_entertainment_travel: Plane,
  cat_exp_entertainment_fitness: Dumbbell,
  // 医疗
  cat_exp_medical_drug: Pill,
  cat_exp_medical_clinic: Stethoscope,
  cat_exp_medical_hospital: Hospital,
  cat_exp_medical_checkup: Activity,
  // 教育
  cat_exp_education_tuition: GraduationCap,
  cat_exp_education_training: Presentation,
  cat_exp_education_books: BookOpen,
  // 人情
  cat_exp_human_gift: Gift,
  cat_exp_human_redpacket: Gift,
  cat_exp_human_filial: HeartHandshake,
  // 其他
  cat_exp_other_express: Package,
  cat_exp_other_pet: PawPrint,
  cat_exp_other_repair: Wrench,
  // 收入
  cat_inc_salary_monthly: Wallet,
  cat_inc_salary_bonus: Trophy,
  cat_inc_bonus_other: Trophy,
  cat_inc_invest_interest: Percent,
  cat_inc_invest_fund: TrendingUp,
  cat_inc_invest_stock: CandlestickChart,
}

export interface CatLike {
  id: string
  name?: string
  icon?: string | null
  parentIcon?: string | null
}

/** 解析分类图标：自身 icon → 细化 id → 父类 icon → 默认 */
export function iconForCat(cat: CatLike, fallback: Component = Utensils): Component {
  if (cat.icon && CAT_ICONS[cat.icon]) return CAT_ICONS[cat.icon]
  if (CAT_ICONS_BY_ID[cat.id]) return CAT_ICONS_BY_ID[cat.id]
  if (cat.parentIcon && CAT_ICONS[cat.parentIcon]) return CAT_ICONS[cat.parentIcon]
  return fallback
}

/** 大类图标（供分类管理页等直接使用） */
export function iconForGroup(icon?: string | null): Component {
  return (icon && CAT_ICONS[icon]) || Utensils
}

/** 可选图标列表（供分类图标选择器使用） */
export const AVAILABLE_ICONS: { key: string; comp: Component }[] =
  Object.entries(CAT_ICONS).map(([key, comp]) => ({ key, comp }))
